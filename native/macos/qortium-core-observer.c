#ifndef _DARWIN_C_SOURCE
#define _DARWIN_C_SOURCE 1
#endif

#include <arpa/inet.h>
#include <errno.h>
#include <inttypes.h>
#include <libproc.h>
#include <limits.h>
#include <netinet/in.h>
#include <stdbool.h>
#include <signal.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/proc_info.h>
#include <sys/socket.h>
#include <sys/sysctl.h>
#include <sys/types.h>
#include <unistd.h>

#ifndef KERN_PROCARGS2
#define KERN_PROCARGS2 49
#endif

#define SCHEMA_NAME "qortium-core-observer"
#define SCHEMA_VERSION 1
#define OBSERVER_PLATFORM "darwin"
#if defined(__arm64__)
#define OBSERVER_ARCH "arm64"
#elif defined(__x86_64__)
#define OBSERVER_ARCH "x64"
#else
#error "Unsupported macOS observer architecture"
#endif
#define MAX_JSON_BYTES (8U * 1024U * 1024U)
#define MAX_PROCESS_COUNT 32768U
#define MAX_ARG_BYTES (2U * 1024U * 1024U)
#define MAX_ARG_COUNT 4096U
#define MAX_FD_BYTES (8U * 1024U * 1024U)
#define MAX_MATCHING_SOCKETS 1024U

/*
 * Protocol (one compact JSON object per invocation):
 *
 * processes/ok:
 *   schema, schemaVersion, platform, arch, mode, status, effectiveUid, bootSessionId,
 *   processes[{pid,startSeconds,startMicroseconds,executablePathBase64,
 *              canonicalCwdBase64,argvBase64[]}]
 * listener/owners:
 *   schema, schemaVersion, platform, arch, mode, status, effectiveUid, bootSessionId, port,
 *   pids[], holders[{pid,startSeconds,startMicroseconds,socketIds[]}]
 * listener/absent:
 *   schema, schemaVersion, platform, arch, mode, status, effectiveUid, bootSessionId, port
 * either mode/unknown:
 *   schema, schemaVersion, platform, arch, mode, status, effectiveUid, bootSessionId,
 *   optional port, reason
 *
 * Byte-bearing process fields use RFC 4648 base64 so the helper never has to
 * reinterpret argv or path bytes as Unicode. KERN_PROCARGS2 also contains the
 * environment after argv; parsing stops after exactly argc strings.
 */

struct json_buffer {
    char *bytes;
    size_t length;
    size_t capacity;
    bool failed;
};

struct argv_view {
    unsigned char *storage;
    const unsigned char **items;
    size_t *lengths;
    size_t count;
};

struct socket_identity {
    uint64_t socket_handle;
    uint64_t generation;
};

static void json_buffer_free(struct json_buffer *buffer) {
    free(buffer->bytes);
    buffer->bytes = NULL;
    buffer->length = 0;
    buffer->capacity = 0;
    buffer->failed = false;
}

static bool json_buffer_reserve(struct json_buffer *buffer, size_t additional) {
    if (buffer->failed || additional > MAX_JSON_BYTES || buffer->length > MAX_JSON_BYTES - additional) {
        buffer->failed = true;
        return false;
    }
    size_t needed = buffer->length + additional + 1U;
    if (needed <= buffer->capacity) {
        return true;
    }
    size_t capacity = buffer->capacity == 0 ? 1024U : buffer->capacity;
    while (capacity < needed) {
        if (capacity > (MAX_JSON_BYTES + 1U) / 2U) {
            capacity = MAX_JSON_BYTES + 1U;
            break;
        }
        capacity *= 2U;
    }
    char *replacement = realloc(buffer->bytes, capacity);
    if (replacement == NULL) {
        buffer->failed = true;
        return false;
    }
    buffer->bytes = replacement;
    buffer->capacity = capacity;
    return true;
}

static bool json_buffer_append_bytes(struct json_buffer *buffer, const char *bytes, size_t length) {
    if (!json_buffer_reserve(buffer, length)) {
        return false;
    }
    memcpy(buffer->bytes + buffer->length, bytes, length);
    buffer->length += length;
    buffer->bytes[buffer->length] = '\0';
    return true;
}

static bool json_buffer_append(struct json_buffer *buffer, const char *text) {
    return json_buffer_append_bytes(buffer, text, strlen(text));
}

static bool json_buffer_append_format(struct json_buffer *buffer, const char *format, ...) {
    va_list arguments;
    va_start(arguments, format);
    va_list copy;
    va_copy(copy, arguments);
    int required = vsnprintf(NULL, 0, format, copy);
    va_end(copy);
    if (required < 0 || !json_buffer_reserve(buffer, (size_t)required)) {
        va_end(arguments);
        buffer->failed = true;
        return false;
    }
    int written = vsnprintf(buffer->bytes + buffer->length, buffer->capacity - buffer->length, format, arguments);
    va_end(arguments);
    if (written != required) {
        buffer->failed = true;
        return false;
    }
    buffer->length += (size_t)written;
    return true;
}

static bool json_buffer_append_base64(struct json_buffer *buffer, const unsigned char *bytes, size_t length) {
    static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    if (!json_buffer_append(buffer, "\"")) {
        return false;
    }
    for (size_t offset = 0; offset < length; offset += 3U) {
        uint32_t value = (uint32_t)bytes[offset] << 16U;
        size_t remaining = length - offset;
        if (remaining > 1U) {
            value |= (uint32_t)bytes[offset + 1U] << 8U;
        }
        if (remaining > 2U) {
            value |= bytes[offset + 2U];
        }
        char encoded[4];
        encoded[0] = alphabet[(value >> 18U) & 0x3fU];
        encoded[1] = alphabet[(value >> 12U) & 0x3fU];
        encoded[2] = remaining > 1U ? alphabet[(value >> 6U) & 0x3fU] : '=';
        encoded[3] = remaining > 2U ? alphabet[value & 0x3fU] : '=';
        if (!json_buffer_append_bytes(buffer, encoded, sizeof(encoded))) {
            return false;
        }
    }
    return json_buffer_append(buffer, "\"");
}

static bool valid_boot_session_id(const char *value) {
    size_t length = strlen(value);
    if (length == 0 || length > 64U) {
        return false;
    }
    for (size_t index = 0; index < length; ++index) {
        char character = value[index];
        bool valid = (character >= '0' && character <= '9') ||
            (character >= 'a' && character <= 'z') ||
            (character >= 'A' && character <= 'Z') || character == '-';
        if (!valid) {
            return false;
        }
    }
    return true;
}

static bool read_boot_session_id(char output[65]) {
    char value[128];
    memset(value, 0, sizeof(value));
    size_t length = sizeof(value) - 1U;
    if (sysctlbyname("kern.bootsessionuuid", value, &length, NULL, 0) != 0) {
        return false;
    }
    value[sizeof(value) - 1U] = '\0';
    if (!valid_boot_session_id(value)) {
        return false;
    }
    memcpy(output, value, strlen(value) + 1U);
    return true;
}

static bool read_bsd_info(pid_t pid, struct proc_bsdinfo *output) {
    memset(output, 0, sizeof(*output));
    int bytes = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, output, (int)sizeof(*output));
    if (bytes != (int)sizeof(*output) || output->pbi_pid != (uint32_t)pid) {
        return false;
    }
    output->pbi_comm[sizeof(output->pbi_comm) - 1U] = '\0';
    output->pbi_name[sizeof(output->pbi_name) - 1U] = '\0';
    return true;
}

static bool same_process_identity(const struct proc_bsdinfo *left, const struct proc_bsdinfo *right) {
    return left->pbi_pid == right->pbi_pid && left->pbi_uid == right->pbi_uid &&
        left->pbi_start_tvsec == right->pbi_start_tvsec &&
        left->pbi_start_tvusec == right->pbi_start_tvusec;
}

static bool process_is_gone(pid_t pid) {
    errno = 0;
    return kill(pid, 0) != 0 && errno == ESRCH;
}

static int compare_pids(const void *left, const void *right) {
    pid_t left_pid = *(const pid_t *)left;
    pid_t right_pid = *(const pid_t *)right;
    return (left_pid > right_pid) - (left_pid < right_pid);
}

static bool list_current_user_pids(uid_t effective_uid, pid_t **pids_out, size_t *count_out) {
    *pids_out = NULL;
    *count_out = 0;
    int required = proc_listpids(PROC_UID_ONLY, (uint32_t)effective_uid, NULL, 0);
    if (required < 0) {
        return false;
    }
    size_t capacity = (size_t)required + 256U * sizeof(pid_t);
    if (capacity < 256U * sizeof(pid_t)) {
        capacity = 256U * sizeof(pid_t);
    }
    if (capacity > MAX_PROCESS_COUNT * sizeof(pid_t)) {
        return false;
    }

    pid_t *pids = NULL;
    int bytes = 0;
    bool complete = false;
    for (unsigned attempt = 0; attempt < 4U; ++attempt) {
        pid_t *replacement = realloc(pids, capacity);
        if (replacement == NULL) {
            free(pids);
            return false;
        }
        pids = replacement;
        memset(pids, 0, capacity);
        bytes = proc_listpids(PROC_UID_ONLY, (uint32_t)effective_uid, pids, (int)capacity);
        if (bytes < 0) {
            free(pids);
            return false;
        }
        if ((size_t)bytes + sizeof(pid_t) < capacity) {
            complete = true;
            break;
        }
        if (capacity >= MAX_PROCESS_COUNT * sizeof(pid_t)) {
            free(pids);
            return false;
        }
        capacity *= 2U;
        if (capacity > MAX_PROCESS_COUNT * sizeof(pid_t)) {
            capacity = MAX_PROCESS_COUNT * sizeof(pid_t);
        }
    }

    if (!complete) {
        free(pids);
        return false;
    }

    size_t count = (size_t)bytes / sizeof(pid_t);
    qsort(pids, count, sizeof(pid_t), compare_pids);
    size_t retained = 0;
    for (size_t index = 0; index < count; ++index) {
        if (pids[index] <= 0 || (retained > 0 && pids[retained - 1U] == pids[index])) {
            continue;
        }
        pids[retained++] = pids[index];
    }
    *pids_out = pids;
    *count_out = retained;
    return true;
}

static bool is_java_name(const char *path_or_name) {
    const char *basename = strrchr(path_or_name, '/');
    basename = basename == NULL ? path_or_name : basename + 1;
    return strcasecmp(basename, "java") == 0 || strcasecmp(basename, "javaw") == 0;
}

static void argv_view_free(struct argv_view *view) {
    free(view->storage);
    free(view->items);
    free(view->lengths);
    memset(view, 0, sizeof(*view));
}

static bool read_raw_argv(pid_t pid, struct argv_view *view) {
    memset(view, 0, sizeof(*view));
    int argument_max = 0;
    size_t argument_max_size = sizeof(argument_max);
    int argument_max_mib[2] = { CTL_KERN, KERN_ARGMAX };
    if (sysctl(argument_max_mib, 2, &argument_max, &argument_max_size, NULL, 0) != 0 ||
        argument_max <= (int)sizeof(int) || (size_t)argument_max > MAX_ARG_BYTES) {
        return false;
    }

    unsigned char *storage = calloc(1U, (size_t)argument_max);
    if (storage == NULL) {
        return false;
    }
    size_t bytes = (size_t)argument_max;
    int arguments_mib[3] = { CTL_KERN, KERN_PROCARGS2, pid };
    if (sysctl(arguments_mib, 3, storage, &bytes, NULL, 0) != 0 || bytes <= sizeof(int)) {
        free(storage);
        return false;
    }

    int argument_count = 0;
    memcpy(&argument_count, storage, sizeof(argument_count));
    if (argument_count < 1 || (size_t)argument_count > MAX_ARG_COUNT) {
        free(storage);
        return false;
    }

    unsigned char *cursor = storage + sizeof(int);
    unsigned char *end = storage + bytes;
    unsigned char *executable_end = memchr(cursor, '\0', (size_t)(end - cursor));
    if (executable_end == NULL) {
        free(storage);
        return false;
    }
    cursor = executable_end + 1;
    while (cursor < end && *cursor == '\0') {
        ++cursor;
    }

    const unsigned char **items = calloc((size_t)argument_count, sizeof(*items));
    size_t *lengths = calloc((size_t)argument_count, sizeof(*lengths));
    if (items == NULL || lengths == NULL) {
        free(items);
        free(lengths);
        free(storage);
        return false;
    }
    for (int index = 0; index < argument_count; ++index) {
        if (cursor >= end) {
            free(items);
            free(lengths);
            free(storage);
            return false;
        }
        unsigned char *terminator = memchr(cursor, '\0', (size_t)(end - cursor));
        if (terminator == NULL) {
            free(items);
            free(lengths);
            free(storage);
            return false;
        }
        items[index] = cursor;
        lengths[index] = (size_t)(terminator - cursor);
        cursor = terminator + 1;
    }
    view->storage = storage;
    view->items = items;
    view->lengths = lengths;
    view->count = (size_t)argument_count;
    return true;
}

static bool append_process_entry(
    struct json_buffer *entries,
    bool prepend_comma,
    pid_t pid,
    const struct proc_bsdinfo *identity,
    const char *canonical_executable,
    const char *canonical_cwd,
    const struct argv_view *arguments
) {
    if (prepend_comma && !json_buffer_append(entries, ",")) {
        return false;
    }
    if (!json_buffer_append_format(
        entries,
        "{\"pid\":%d,\"startSeconds\":\"%" PRIu64 "\",\"startMicroseconds\":\"%" PRIu64
        "\",\"executablePathBase64\":",
        pid,
        identity->pbi_start_tvsec,
        identity->pbi_start_tvusec
    ) || !json_buffer_append_base64(
        entries,
        (const unsigned char *)canonical_executable,
        strlen(canonical_executable)
    ) || !json_buffer_append(entries, ",\"canonicalCwdBase64\":") || !json_buffer_append_base64(
        entries,
        (const unsigned char *)canonical_cwd,
        strlen(canonical_cwd)
    ) || !json_buffer_append(entries, ",\"argvBase64\":[")) {
        return false;
    }
    for (size_t index = 0; index < arguments->count; ++index) {
        if ((index > 0 && !json_buffer_append(entries, ",")) ||
            !json_buffer_append_base64(entries, arguments->items[index], arguments->lengths[index])) {
            return false;
        }
    }
    return json_buffer_append(entries, "]}");
}

static void print_unknown(const char *mode, uid_t uid, const char *boot_session_id, int port, const char *reason) {
    if (port > 0) {
        printf(
            "{\"schema\":\"%s\",\"schemaVersion\":%d,\"platform\":\"%s\",\"arch\":\"%s\","
            "\"mode\":\"%s\",\"status\":\"unknown\","
            "\"effectiveUid\":%u,\"bootSessionId\":\"%s\",\"port\":%d,\"reason\":\"%s\"}\n",
            SCHEMA_NAME,
            SCHEMA_VERSION,
            OBSERVER_PLATFORM,
            OBSERVER_ARCH,
            mode,
            (unsigned)uid,
            boot_session_id,
            port,
            reason
        );
    } else {
        printf(
            "{\"schema\":\"%s\",\"schemaVersion\":%d,\"platform\":\"%s\",\"arch\":\"%s\","
            "\"mode\":\"%s\",\"status\":\"unknown\","
            "\"effectiveUid\":%u,\"bootSessionId\":\"%s\",\"reason\":\"%s\"}\n",
            SCHEMA_NAME,
            SCHEMA_VERSION,
            OBSERVER_PLATFORM,
            OBSERVER_ARCH,
            mode,
            (unsigned)uid,
            boot_session_id,
            reason
        );
    }
}

static int observe_processes(void) {
    uid_t effective_uid = geteuid();
    char boot_session_id[65];
    if (!read_boot_session_id(boot_session_id)) {
        print_unknown("processes", effective_uid, "unavailable", 0, "boot-session-unavailable");
        return 0;
    }

    pid_t *pids = NULL;
    size_t pid_count = 0;
    if (!list_current_user_pids(effective_uid, &pids, &pid_count)) {
        print_unknown("processes", effective_uid, boot_session_id, 0, "process-enumeration-failed");
        return 0;
    }

    struct json_buffer entries = {0};
    size_t process_count = 0;
    const char *failure = NULL;
    for (size_t index = 0; index < pid_count && failure == NULL; ++index) {
        pid_t pid = pids[index];
        struct proc_bsdinfo before;
        if (!read_bsd_info(pid, &before)) {
            if (!process_is_gone(pid)) {
                failure = "process-identity-unavailable";
            }
            continue;
        }
        if (before.pbi_uid != effective_uid) {
            failure = "process-effective-uid-changed";
            break;
        }

        char executable_path[PROC_PIDPATHINFO_MAXSIZE];
        memset(executable_path, 0, sizeof(executable_path));
        int executable_length = proc_pidpath(pid, executable_path, (uint32_t)sizeof(executable_path));
        bool java_candidate = is_java_name(before.pbi_comm) ||
            (executable_length > 0 && is_java_name(executable_path));
        if (!java_candidate) {
            continue;
        }
        if (executable_length <= 0 || (size_t)executable_length >= sizeof(executable_path) ||
            memchr(executable_path, '\0', sizeof(executable_path)) == NULL) {
            failure = process_is_gone(pid) ? NULL : "candidate-executable-unavailable";
            continue;
        }
        executable_path[sizeof(executable_path) - 1U] = '\0';

        char canonical_executable[PATH_MAX];
        if (realpath(executable_path, canonical_executable) == NULL) {
            failure = process_is_gone(pid) ? NULL : "candidate-executable-canonicalization-failed";
            continue;
        }

        struct argv_view arguments;
        if (!read_raw_argv(pid, &arguments)) {
            failure = process_is_gone(pid) ? NULL : "candidate-argv-unavailable";
            continue;
        }

        struct proc_vnodepathinfo paths;
        memset(&paths, 0, sizeof(paths));
        int path_bytes = proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, &paths, (int)sizeof(paths));
        if (path_bytes != (int)sizeof(paths) || paths.pvi_cdir.vip_path[0] == '\0') {
            argv_view_free(&arguments);
            failure = process_is_gone(pid) ? NULL : "candidate-cwd-unavailable";
            continue;
        }
        char canonical_cwd[PATH_MAX];
        if (realpath(paths.pvi_cdir.vip_path, canonical_cwd) == NULL) {
            argv_view_free(&arguments);
            failure = process_is_gone(pid) ? NULL : "candidate-cwd-canonicalization-failed";
            continue;
        }

        struct proc_bsdinfo after;
        if (!read_bsd_info(pid, &after)) {
            argv_view_free(&arguments);
            if (process_is_gone(pid)) {
                continue;
            }
            failure = "candidate-identity-revalidation-failed";
            break;
        }
        if (!same_process_identity(&before, &after)) {
            argv_view_free(&arguments);
            failure = "candidate-identity-changed";
            break;
        }
        if (!append_process_entry(
            &entries,
            process_count > 0,
            pid,
            &after,
            canonical_executable,
            canonical_cwd,
            &arguments
        )) {
            argv_view_free(&arguments);
            failure = "output-limit-exceeded";
            break;
        }
        ++process_count;
        argv_view_free(&arguments);
    }
    free(pids);

    if (failure != NULL) {
        json_buffer_free(&entries);
        print_unknown("processes", effective_uid, boot_session_id, 0, failure);
        return 0;
    }

    printf(
        "{\"schema\":\"%s\",\"schemaVersion\":%d,\"platform\":\"%s\",\"arch\":\"%s\","
        "\"mode\":\"processes\",\"status\":\"ok\","
        "\"effectiveUid\":%u,\"bootSessionId\":\"%s\",\"processes\":[",
        SCHEMA_NAME,
        SCHEMA_VERSION,
        OBSERVER_PLATFORM,
        OBSERVER_ARCH,
        (unsigned)effective_uid,
        boot_session_id
    );
    if (entries.length > 0) {
        fwrite(entries.bytes, 1U, entries.length, stdout);
    }
    printf("]}\n");
    json_buffer_free(&entries);
    return 0;
}

static bool list_process_fds(pid_t pid, struct proc_fdinfo **fds_out, size_t *count_out) {
    *fds_out = NULL;
    *count_out = 0;
    int required = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, NULL, 0);
    if (required <= 0) {
        return false;
    }
    size_t capacity = (size_t)required + 64U * sizeof(struct proc_fdinfo);
    if (capacity > MAX_FD_BYTES) {
        return false;
    }
    struct proc_fdinfo *fds = NULL;
    int bytes = 0;
    bool complete = false;
    for (unsigned attempt = 0; attempt < 4U; ++attempt) {
        struct proc_fdinfo *replacement = realloc(fds, capacity);
        if (replacement == NULL) {
            free(fds);
            return false;
        }
        fds = replacement;
        memset(fds, 0, capacity);
        bytes = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, fds, (int)capacity);
        if (bytes <= 0) {
            free(fds);
            return false;
        }
        if ((size_t)bytes + sizeof(struct proc_fdinfo) < capacity) {
            complete = true;
            break;
        }
        if (capacity >= MAX_FD_BYTES) {
            free(fds);
            return false;
        }
        capacity *= 2U;
        if (capacity > MAX_FD_BYTES) {
            capacity = MAX_FD_BYTES;
        }
    }
    if (!complete) {
        free(fds);
        return false;
    }
    *fds_out = fds;
    *count_out = (size_t)bytes / sizeof(struct proc_fdinfo);
    return true;
}

static bool same_socket_identity(const struct socket_identity *left, const struct socket_identity *right) {
    return left->socket_handle == right->socket_handle && left->generation == right->generation;
}

static int compare_socket_identities(const void *left, const void *right) {
    const struct socket_identity *left_identity = left;
    const struct socket_identity *right_identity = right;
    if (left_identity->socket_handle != right_identity->socket_handle) {
        return (left_identity->socket_handle > right_identity->socket_handle) -
            (left_identity->socket_handle < right_identity->socket_handle);
    }
    return (left_identity->generation > right_identity->generation) -
        (left_identity->generation < right_identity->generation);
}

static bool socket_matches_listener(const struct socket_fdinfo *socket_info, int port) {
    const struct socket_info *socket = &socket_info->psi;
    if (socket->soi_kind != SOCKINFO_TCP || socket->soi_protocol != IPPROTO_TCP ||
        (socket->soi_family != AF_INET && socket->soi_family != AF_INET6)) {
        return false;
    }
    const struct tcp_sockinfo *tcp = &socket->soi_proto.pri_tcp;
    return tcp->tcpsi_state == TSI_S_LISTEN && ntohs((uint16_t)tcp->tcpsi_ini.insi_lport) == port;
}

static bool append_listener_holder(
    struct json_buffer *holders,
    bool prepend_comma,
    pid_t pid,
    const struct proc_bsdinfo *identity,
    const struct socket_identity *sockets,
    size_t socket_count
) {
    if (prepend_comma && !json_buffer_append(holders, ",")) {
        return false;
    }
    if (!json_buffer_append_format(
        holders,
        "{\"pid\":%d,\"startSeconds\":\"%" PRIu64 "\",\"startMicroseconds\":\"%" PRIu64
        "\",\"socketIds\":[",
        pid,
        identity->pbi_start_tvsec,
        identity->pbi_start_tvusec
    )) {
        return false;
    }
    for (size_t index = 0; index < socket_count; ++index) {
        if ((index > 0 && !json_buffer_append(holders, ",")) || !json_buffer_append_format(
            holders,
            "\"%016" PRIx64 ":%" PRIu64 "\"",
            sockets[index].socket_handle,
            sockets[index].generation
        )) {
            return false;
        }
    }
    return json_buffer_append(holders, "]}");
}

enum bind_probe_result {
    BIND_PROBE_FREE,
    BIND_PROBE_OCCUPIED,
    BIND_PROBE_UNKNOWN
};

static enum bind_probe_result bind_probe(int port) {
    int ipv4 = socket(AF_INET, SOCK_STREAM, 0);
    if (ipv4 < 0) {
        return BIND_PROBE_UNKNOWN;
    }
    int ipv4_flags = 1;
    (void)setsockopt(ipv4, SOL_SOCKET, SO_NOSIGPIPE, &ipv4_flags, (socklen_t)sizeof(ipv4_flags));
    struct sockaddr_in ipv4_address;
    memset(&ipv4_address, 0, sizeof(ipv4_address));
    ipv4_address.sin_len = sizeof(ipv4_address);
    ipv4_address.sin_family = AF_INET;
    ipv4_address.sin_port = htons((uint16_t)port);
    ipv4_address.sin_addr.s_addr = htonl(INADDR_ANY);
    if (bind(ipv4, (const struct sockaddr *)&ipv4_address, (socklen_t)sizeof(ipv4_address)) != 0) {
        enum bind_probe_result result = errno == EADDRINUSE ? BIND_PROBE_OCCUPIED : BIND_PROBE_UNKNOWN;
        close(ipv4);
        return result;
    }

    int ipv6 = socket(AF_INET6, SOCK_STREAM, 0);
    if (ipv6 < 0) {
        close(ipv4);
        return BIND_PROBE_UNKNOWN;
    }
    int ipv6_only = 1;
    if (setsockopt(ipv6, IPPROTO_IPV6, IPV6_V6ONLY, &ipv6_only, (socklen_t)sizeof(ipv6_only)) != 0) {
        close(ipv6);
        close(ipv4);
        return BIND_PROBE_UNKNOWN;
    }
    struct sockaddr_in6 ipv6_address;
    memset(&ipv6_address, 0, sizeof(ipv6_address));
    ipv6_address.sin6_len = sizeof(ipv6_address);
    ipv6_address.sin6_family = AF_INET6;
    ipv6_address.sin6_port = htons((uint16_t)port);
    ipv6_address.sin6_addr = in6addr_any;
    enum bind_probe_result result = BIND_PROBE_FREE;
    if (bind(ipv6, (const struct sockaddr *)&ipv6_address, (socklen_t)sizeof(ipv6_address)) != 0) {
        result = errno == EADDRINUSE ? BIND_PROBE_OCCUPIED : BIND_PROBE_UNKNOWN;
    }
    close(ipv6);
    close(ipv4);
    return result;
}

static int observe_listener(int port) {
    uid_t effective_uid = geteuid();
    char boot_session_id[65];
    if (!read_boot_session_id(boot_session_id)) {
        print_unknown("listener", effective_uid, "unavailable", port, "boot-session-unavailable");
        return 0;
    }

    pid_t *pids = NULL;
    size_t pid_count = 0;
    if (!list_current_user_pids(effective_uid, &pids, &pid_count)) {
        print_unknown("listener", effective_uid, boot_session_id, port, "process-enumeration-failed");
        return 0;
    }

    struct json_buffer holders = {0};
    struct json_buffer owner_pids = {0};
    size_t holder_count = 0;
    const char *failure = NULL;
    for (size_t index = 0; index < pid_count && failure == NULL; ++index) {
        pid_t pid = pids[index];
        struct proc_bsdinfo before;
        if (!read_bsd_info(pid, &before)) {
            if (!process_is_gone(pid)) {
                failure = "listener-process-identity-unavailable";
            }
            continue;
        }
        if (before.pbi_uid != effective_uid) {
            failure = "listener-process-effective-uid-changed";
            break;
        }
        struct proc_fdinfo *fds = NULL;
        size_t fd_count = 0;
        if (!list_process_fds(pid, &fds, &fd_count)) {
            if (!process_is_gone(pid)) {
                failure = "listener-process-fds-unavailable";
            }
            continue;
        }

        struct socket_identity matches[MAX_MATCHING_SOCKETS];
        size_t match_count = 0;
        for (size_t fd_index = 0; fd_index < fd_count; ++fd_index) {
            if (fds[fd_index].proc_fdtype != PROX_FDTYPE_SOCKET) {
                continue;
            }
            struct socket_fdinfo socket_info;
            memset(&socket_info, 0, sizeof(socket_info));
            int socket_bytes = proc_pidfdinfo(
                pid,
                fds[fd_index].proc_fd,
                PROC_PIDFDSOCKETINFO,
                &socket_info,
                (int)sizeof(socket_info)
            );
            if (socket_bytes != (int)sizeof(socket_info)) {
                if (!process_is_gone(pid)) {
                    failure = "listener-socket-evidence-unavailable";
                }
                break;
            }
            if (!socket_matches_listener(&socket_info, port)) {
                continue;
            }
            if (match_count >= MAX_MATCHING_SOCKETS) {
                failure = "matching-socket-limit-exceeded";
                break;
            }
            matches[match_count].socket_handle = socket_info.psi.soi_so;
            matches[match_count].generation = socket_info.psi.soi_proto.pri_tcp.tcpsi_ini.insi_gencnt;
            ++match_count;
        }
        free(fds);
        if (failure != NULL || match_count == 0) {
            continue;
        }

        qsort(matches, match_count, sizeof(matches[0]), compare_socket_identities);
        size_t retained = 0;
        for (size_t socket_index = 0; socket_index < match_count; ++socket_index) {
            if (retained > 0 && same_socket_identity(&matches[retained - 1U], &matches[socket_index])) {
                continue;
            }
            matches[retained++] = matches[socket_index];
        }
        match_count = retained;

        struct proc_bsdinfo after;
        if (!read_bsd_info(pid, &after)) {
            if (process_is_gone(pid)) {
                continue;
            }
            failure = "listener-owner-identity-revalidation-failed";
            break;
        }
        if (!same_process_identity(&before, &after)) {
            failure = "listener-owner-identity-changed";
            break;
        }
        if (!append_listener_holder(&holders, holder_count > 0, pid, &after, matches, match_count) ||
            (holder_count > 0 && !json_buffer_append(&owner_pids, ",")) ||
            !json_buffer_append_format(&owner_pids, "%d", pid)) {
            failure = "output-limit-exceeded";
            break;
        }
        ++holder_count;
    }
    free(pids);

    if (failure != NULL) {
        json_buffer_free(&holders);
        json_buffer_free(&owner_pids);
        print_unknown("listener", effective_uid, boot_session_id, port, failure);
        return 0;
    }
    if (holder_count > 0) {
        printf(
            "{\"schema\":\"%s\",\"schemaVersion\":%d,\"platform\":\"%s\",\"arch\":\"%s\","
            "\"mode\":\"listener\",\"status\":\"owners\","
            "\"effectiveUid\":%u,\"bootSessionId\":\"%s\",\"port\":%d,\"pids\":[",
            SCHEMA_NAME,
            SCHEMA_VERSION,
            OBSERVER_PLATFORM,
            OBSERVER_ARCH,
            (unsigned)effective_uid,
            boot_session_id,
            port
        );
        fwrite(owner_pids.bytes, 1U, owner_pids.length, stdout);
        printf("],\"holders\":[");
        fwrite(holders.bytes, 1U, holders.length, stdout);
        printf("]}\n");
        json_buffer_free(&holders);
        json_buffer_free(&owner_pids);
        return 0;
    }

    json_buffer_free(&holders);
    json_buffer_free(&owner_pids);
    enum bind_probe_result probe = bind_probe(port);
    if (probe == BIND_PROBE_FREE) {
        printf(
            "{\"schema\":\"%s\",\"schemaVersion\":%d,\"platform\":\"%s\",\"arch\":\"%s\","
            "\"mode\":\"listener\",\"status\":\"absent\","
            "\"effectiveUid\":%u,\"bootSessionId\":\"%s\",\"port\":%d}\n",
            SCHEMA_NAME,
            SCHEMA_VERSION,
            OBSERVER_PLATFORM,
            OBSERVER_ARCH,
            (unsigned)effective_uid,
            boot_session_id,
            port
        );
    } else {
        print_unknown(
            "listener",
            effective_uid,
            boot_session_id,
            port,
            probe == BIND_PROBE_OCCUPIED ? "listener-occupied-without-visible-owner" : "listener-bind-probe-failed"
        );
    }
    return 0;
}

static bool parse_port(const char *value, int *port_out) {
    if (value == NULL || value[0] == '\0') {
        return false;
    }
    errno = 0;
    char *end = NULL;
    long parsed = strtol(value, &end, 10);
    if (errno != 0 || end == value || *end != '\0' || parsed < 1 || parsed > 65535) {
        return false;
    }
    *port_out = (int)parsed;
    return true;
}

static int self_test(void) {
    const unsigned char vector[] = { 0x00U, 0x01U, 0x02U, 0xfdU, 0xfeU, 0xffU };
    struct json_buffer encoded = {0};
    bool ok = json_buffer_append_base64(&encoded, vector, sizeof(vector)) &&
        strcmp(encoded.bytes, "\"AAEC/f7/\"") == 0;
    int port = 0;
    ok = ok && parse_port("12391", &port) && port == 12391 && !parse_port("0", &port) &&
        !parse_port("65536", &port) && !parse_port("12391x", &port);
    json_buffer_free(&encoded);
    printf(
        "{\"schema\":\"%s\",\"schemaVersion\":%d,\"platform\":\"%s\",\"arch\":\"%s\","
        "\"mode\":\"self-test\",\"status\":\"%s\"}\n",
        SCHEMA_NAME,
        SCHEMA_VERSION,
        OBSERVER_PLATFORM,
        OBSERVER_ARCH,
        ok ? "ok" : "failed"
    );
    return ok ? 0 : 1;
}

static void print_usage(const char *program) {
    fprintf(stderr, "Usage: %s processes | listener --port N | self-test\n", program);
}

int main(int argc, char **argv) {
    if (argc == 2 && strcmp(argv[1], "processes") == 0) {
        return observe_processes();
    }
    if (argc == 4 && strcmp(argv[1], "listener") == 0 && strcmp(argv[2], "--port") == 0) {
        int port = 0;
        if (!parse_port(argv[3], &port)) {
            print_usage(argv[0]);
            return 64;
        }
        return observe_listener(port);
    }
    if (argc == 2 && strcmp(argv[1], "self-test") == 0) {
        return self_test();
    }
    print_usage(argv[0]);
    return 64;
}
