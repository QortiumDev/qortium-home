#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif

#include <aclapi.h>
#include <iphlpapi.h>
#include <sddl.h>
#include <shellapi.h>
#include <tlhelp32.h>
#include <windows.h>
#include <winsock2.h>
#include <winternl.h>
#include <ws2tcpip.h>

#include <algorithm>
#include <cerrno>
#include <climits>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <limits>
#include <set>
#include <string>
#include <utility>
#include <vector>

#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "iphlpapi.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "ws2_32.lib")
#ifdef _MSC_VER
#pragma warning(disable : 4191) // GetProcAddress is the documented resolver for
                                // these Win32/NT entry points.
#endif

namespace {

constexpr char kSchema[] = "qortium-core-observer";
constexpr unsigned kSchemaVersion = 1;
constexpr char kPlatform[] = "win32";
constexpr char kArch[] = "x64";
constexpr std::size_t kMaxProcesses = 32768;
constexpr std::size_t kMaxArguments = 4096;
constexpr std::size_t kMaxArgumentBytes = 2U * 1024U * 1024U;
constexpr std::size_t kMaxTotalArgumentBytes = 2U * 1024U * 1024U;
constexpr std::size_t kMaxPathBytes = 32U * 1024U;
constexpr std::size_t kMaxJsonBytes = 1024U * 1024U;
constexpr DWORD kAbsoluteMaxSecureFileBytes = 512U * 1024U;

// These offsets are the x64 layout consumed by the Windows helper. They are
// deliberately isolated and validated against the target process instead of
// pretending that the PEB is a supported public API. Any access, size, pointer,
// owner, or creation-time inconsistency fails closed.
constexpr std::uintptr_t kPebProcessParametersOffset = 0x20;
constexpr std::uintptr_t kParametersCurrentDirectoryOffset = 0x38;
constexpr std::uintptr_t kParametersCommandLineOffset = 0x70;

// OBJ_DONT_REPARSE makes the object manager reject a reparse point anywhere in
// path traversal. FILE_OPEN_REPARSE_POINT independently prevents following the
// final component. This is stronger than
// CreateFile(FILE_FLAG_OPEN_REPARSE_POINT), which protects only the last
// component.
constexpr ULONG kObjCaseInsensitive = 0x00000040UL;
constexpr ULONG kObjDontReparse = 0x00001000UL;
constexpr ULONG kFileOpen = 0x00000001UL;
constexpr ULONG kFileNonDirectoryFile = 0x00000040UL;
constexpr ULONG kFileSynchronousIoNonalert = 0x00000020UL;
constexpr ULONG kFileOpenReparsePoint = 0x00200000UL;
constexpr LONG kStatusReparsePointEncountered = static_cast<LONG>(0xC000050BUL);

struct Handle {
  HANDLE value = INVALID_HANDLE_VALUE;
  Handle() = default;
  explicit Handle(HANDLE input) : value(input) {}
  Handle(const Handle &) = delete;
  Handle &operator=(const Handle &) = delete;
  Handle(Handle &&other) noexcept : value(other.value) {
    other.value = INVALID_HANDLE_VALUE;
  }
  Handle &operator=(Handle &&other) noexcept {
    if (this != &other) {
      reset();
      value = other.value;
      other.value = INVALID_HANDLE_VALUE;
    }
    return *this;
  }
  ~Handle() { reset(); }
  void reset(HANDLE next = INVALID_HANDLE_VALUE) {
    if (value != INVALID_HANDLE_VALUE && value != nullptr)
      CloseHandle(value);
    value = next;
  }
  bool valid() const {
    return value != INVALID_HANDLE_VALUE && value != nullptr;
  }
};

struct LocalMemory {
  HLOCAL value = nullptr;
  ~LocalMemory() {
    if (value != nullptr)
      LocalFree(value);
  }
};

struct LocalSecurityDescriptor {
  PSECURITY_DESCRIPTOR value = nullptr;
  ~LocalSecurityDescriptor() {
    if (value != nullptr)
      LocalFree(value);
  }
};

struct SocketHandle {
  SOCKET value = INVALID_SOCKET;
  ~SocketHandle() {
    if (value != INVALID_SOCKET)
      closesocket(value);
  }
};

struct WinsockSession {
  bool active = false;
  ~WinsockSession() {
    if (active)
      WSACleanup();
  }
};

struct ProcessIdentity {
  DWORD pid = 0;
  ULARGE_INTEGER creation{};
  std::wstring ownerSid;
};

struct ProcessEvidence {
  ProcessIdentity identity;
  std::wstring executablePath;
  std::wstring canonicalCwd;
  std::wstring rawCommandLine;
  std::vector<std::wstring> argv;
};

struct RemoteUnicodeString64 {
  USHORT length;
  USHORT maximumLength;
  ULONG padding;
  std::uint64_t buffer;
};
static_assert(sizeof(RemoteUnicodeString64) == 16,
              "Unexpected x64 UNICODE_STRING layout");

struct TcpSnapshot {
  std::set<DWORD> pids;
};

struct FileIdentity {
  std::uint64_t volumeSerial = 0;
  FILE_ID_128 fileId{};
  ULARGE_INTEGER size{};
  FILETIME lastWrite{};
};

using NtQueryInformationProcessFn = LONG(NTAPI *)(HANDLE, PROCESSINFOCLASS,
                                                  PVOID, ULONG, PULONG);
using NtCreateFileFn = LONG(NTAPI *)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES,
                                     PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG,
                                     ULONG, ULONG, ULONG, PVOID, ULONG);
using RtlGetVersionFn = LONG(WINAPI *)(OSVERSIONINFOW *);

bool isSuccess(LONG status) { return status >= 0; }

bool supportedPebLayout() {
  const HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (ntdll == nullptr)
    return false;
  const auto getVersion =
      reinterpret_cast<RtlGetVersionFn>(GetProcAddress(ntdll, "RtlGetVersion"));
  if (getVersion == nullptr)
    return false;
  OSVERSIONINFOW version{};
  version.dwOSVersionInfoSize = static_cast<DWORD>(sizeof(version));
  SYSTEM_INFO system{};
  GetNativeSystemInfo(&system);
  return isSuccess(getVersion(&version)) && version.dwMajorVersion == 10 &&
         version.dwBuildNumber >= 10240 && version.dwBuildNumber < 30000 &&
         system.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_AMD64;
}

std::string base64(const std::string &bytes) {
  static constexpr char alphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string output;
  output.reserve(((bytes.size() + 2U) / 3U) * 4U);
  for (std::size_t offset = 0; offset < bytes.size(); offset += 3U) {
    const std::size_t remaining = bytes.size() - offset;
    std::uint32_t value = static_cast<unsigned char>(bytes[offset]) << 16U;
    if (remaining > 1U)
      value |= static_cast<unsigned char>(bytes[offset + 1U]) << 8U;
    if (remaining > 2U)
      value |= static_cast<unsigned char>(bytes[offset + 2U]);
    output.push_back(alphabet[(value >> 18U) & 0x3fU]);
    output.push_back(alphabet[(value >> 12U) & 0x3fU]);
    output.push_back(remaining > 1U ? alphabet[(value >> 6U) & 0x3fU] : '=');
    output.push_back(remaining > 2U ? alphabet[value & 0x3fU] : '=');
  }
  return output;
}

bool wideToUtf8(const std::wstring &value, std::string *output) {
  output->clear();
  if (value.empty())
    return true;
  if (value.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()))
    return false;
  const int needed = WideCharToMultiByte(
      CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
      static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (needed <= 0)
    return false;
  output->resize(static_cast<std::size_t>(needed));
  return WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
                             static_cast<int>(value.size()), output->data(),
                             needed, nullptr, nullptr) == needed;
}

bool appendWideBase64(std::string *output, const std::wstring &value,
                      std::size_t maximumBytes) {
  std::string utf8;
  if (!wideToUtf8(value, &utf8) || utf8.size() > maximumBytes ||
      utf8.find('\0') != std::string::npos)
    return false;
  output->append("\"");
  output->append(base64(utf8));
  output->append("\"");
  return true;
}

std::string decimal64(const ULARGE_INTEGER &value) {
  char buffer[32]{};
  const int written =
      std::snprintf(buffer, sizeof(buffer), "%llu",
                    static_cast<unsigned long long>(value.QuadPart));
  return written > 0 ? std::string(buffer, static_cast<std::size_t>(written))
                     : std::string();
}

std::string decimalUnsigned(std::uint64_t value) {
  ULARGE_INTEGER converted{};
  converted.QuadPart = value;
  return decimal64(converted);
}

std::string fileIdHex(const FILE_ID_128 &value) {
  static constexpr char digits[] = "0123456789abcdef";
  std::string output;
  output.reserve(sizeof(value.Identifier) * 2U);
  for (unsigned char byte : value.Identifier) {
    output.push_back(digits[byte >> 4U]);
    output.push_back(digits[byte & 0x0fU]);
  }
  return output;
}

bool equalFileTime(const FILETIME &left, const FILETIME &right) {
  return left.dwLowDateTime == right.dwLowDateTime &&
         left.dwHighDateTime == right.dwHighDateTime;
}

bool currentTokenSid(std::vector<unsigned char> *sidStorage,
                     std::wstring *sidString) {
  Handle token;
  HANDLE raw = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw))
    return false;
  token.reset(raw);
  DWORD bytes = 0;
  GetTokenInformation(token.value, TokenUser, nullptr, 0, &bytes);
  if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || bytes == 0)
    return false;
  std::vector<unsigned char> tokenInfo(bytes);
  if (!GetTokenInformation(token.value, TokenUser, tokenInfo.data(), bytes,
                           &bytes))
    return false;
  const auto *tokenUser =
      reinterpret_cast<const TOKEN_USER *>(tokenInfo.data());
  const DWORD sidBytes = GetLengthSid(tokenUser->User.Sid);
  if (sidBytes == 0)
    return false;
  sidStorage->resize(sidBytes);
  if (!CopySid(sidBytes, sidStorage->data(), tokenUser->User.Sid))
    return false;
  LPWSTR converted = nullptr;
  if (!ConvertSidToStringSidW(sidStorage->data(), &converted))
    return false;
  LocalMemory holder;
  holder.value = converted;
  *sidString = converted;
  return true;
}

bool processOwnerSid(HANDLE process, std::vector<unsigned char> *storage,
                     std::wstring *text) {
  Handle token;
  HANDLE raw = nullptr;
  if (!OpenProcessToken(process, TOKEN_QUERY, &raw))
    return false;
  token.reset(raw);
  DWORD bytes = 0;
  GetTokenInformation(token.value, TokenUser, nullptr, 0, &bytes);
  if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || bytes == 0)
    return false;
  std::vector<unsigned char> tokenInfo(bytes);
  if (!GetTokenInformation(token.value, TokenUser, tokenInfo.data(), bytes,
                           &bytes))
    return false;
  const auto *user = reinterpret_cast<const TOKEN_USER *>(tokenInfo.data());
  const DWORD sidBytes = GetLengthSid(user->User.Sid);
  if (sidBytes == 0)
    return false;
  storage->resize(sidBytes);
  if (!CopySid(sidBytes, storage->data(), user->User.Sid))
    return false;
  LPWSTR converted = nullptr;
  if (!ConvertSidToStringSidW(storage->data(), &converted))
    return false;
  LocalMemory holder;
  holder.value = converted;
  *text = converted;
  return true;
}

bool processCreation(HANDLE process, ULARGE_INTEGER *output) {
  FILETIME creation{}, exit{}, kernel{}, user{};
  if (!GetProcessTimes(process, &creation, &exit, &kernel, &user))
    return false;
  output->LowPart = creation.dwLowDateTime;
  output->HighPart = creation.dwHighDateTime;
  return output->QuadPart != 0;
}

bool queryIdentity(HANDLE process, DWORD pid, ProcessIdentity *output) {
  std::vector<unsigned char> owner;
  ProcessIdentity value;
  value.pid = pid;
  if (!processCreation(process, &value.creation) ||
      !processOwnerSid(process, &owner, &value.ownerSid))
    return false;
  *output = std::move(value);
  return true;
}

bool sameIdentity(const ProcessIdentity &left, const ProcessIdentity &right) {
  return left.pid == right.pid &&
         left.creation.QuadPart == right.creation.QuadPart &&
         left.ownerSid == right.ownerSid;
}

bool readRemote(HANDLE process, std::uint64_t address, void *output,
                std::size_t bytes) {
  if (address < 0x10000ULL || address > 0x00007fffffffffffULL ||
      bytes > 0x7fffffffULL || address > 0x00007fffffffffffULL - bytes)
    return false;
  SIZE_T read = 0;
  return ReadProcessMemory(
             process,
             reinterpret_cast<LPCVOID>(static_cast<std::uintptr_t>(address)),
             output, bytes, &read) &&
         read == bytes;
}

bool readRemoteWide(HANDLE process, const RemoteUnicodeString64 &remote,
                    std::size_t maximumBytes, bool allowEmpty,
                    std::wstring *output) {
  if ((remote.length & 1U) != 0 || remote.length > remote.maximumLength ||
      remote.length > maximumBytes || (!allowEmpty && remote.length == 0) ||
      (remote.length != 0 && remote.buffer == 0))
    return false;
  output->resize(remote.length / sizeof(wchar_t));
  if (remote.length != 0 &&
      !readRemote(process, remote.buffer, output->data(), remote.length))
    return false;
  return output->find(L'\0') == std::wstring::npos;
}

bool commandLineIsUnambiguous(const std::wstring &commandLine) {
  if (commandLine.empty() || commandLine.front() == L' ' ||
      commandLine.front() == L'\t')
    return false;
  bool quoted = false;
  for (std::size_t index = 0; index < commandLine.size(); ++index) {
    if (commandLine[index] != L'"')
      continue;
    std::size_t precedingBackslashes = 0;
    for (std::size_t cursor = index;
         cursor > 0 && commandLine[cursor - 1] == L'\\'; --cursor) {
      ++precedingBackslashes;
    }
    // CRT-family parsers disagree in edge cases involving a backslash run
    // immediately before a quote. Do not manufacture argv evidence there.
    if (precedingBackslashes != 0)
      return false;
    if (!quoted && index != 0 && commandLine[index - 1] != L' ' &&
        commandLine[index - 1] != L'\t')
      return false;
    if (quoted && index + 1U < commandLine.size() &&
        commandLine[index + 1U] != L' ' && commandLine[index + 1U] != L'\t')
      return false;
    quoted = !quoted;
  }
  return !quoted;
}

bool queryProcessParameters(HANDLE process, std::wstring *cwd,
                            std::wstring *rawCommandLine,
                            std::vector<std::wstring> *argv) {
  const HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (ntdll == nullptr)
    return false;
  const auto query = reinterpret_cast<NtQueryInformationProcessFn>(
      GetProcAddress(ntdll, "NtQueryInformationProcess"));
  if (query == nullptr)
    return false;
  PROCESS_BASIC_INFORMATION basic{};
  ULONG returned = 0;
  if (!isSuccess(query(process, ProcessBasicInformation, &basic,
                       static_cast<ULONG>(sizeof(basic)), &returned)) ||
      returned != static_cast<ULONG>(sizeof(basic)) ||
      basic.PebBaseAddress == nullptr)
    return false;
  std::uint64_t parameters = 0;
  const auto peb = reinterpret_cast<std::uintptr_t>(basic.PebBaseAddress);
  if (!readRemote(process, peb + kPebProcessParametersOffset, &parameters,
                  sizeof(parameters)))
    return false;
  RemoteUnicodeString64 cwdRemote{};
  RemoteUnicodeString64 commandRemote{};
  if (!readRemote(process, parameters + kParametersCurrentDirectoryOffset,
                  &cwdRemote, sizeof(cwdRemote)) ||
      !readRemote(process, parameters + kParametersCommandLineOffset,
                  &commandRemote, sizeof(commandRemote)))
    return false;
  std::wstring rawCwd;
  std::wstring commandLine;
  if (!readRemoteWide(process, cwdRemote, kMaxPathBytes * sizeof(wchar_t),
                      false, &rawCwd) ||
      !readRemoteWide(process, commandRemote,
                      kMaxTotalArgumentBytes * sizeof(wchar_t), false,
                      &commandLine))
    return false;
  if (!commandLineIsUnambiguous(commandLine))
    return false;

  int argumentCount = 0;
  LPWSTR *parsed = CommandLineToArgvW(commandLine.c_str(), &argumentCount);
  if (parsed == nullptr || argumentCount < 1 ||
      argumentCount > static_cast<int>(kMaxArguments))
    return false;
  LocalMemory parsedHolder;
  parsedHolder.value = parsed;
  argv->clear();
  std::size_t totalCharacters = 0;
  for (int index = 0; index < argumentCount; ++index) {
    if (parsed[index] == nullptr)
      return false;
    const std::size_t length = std::wcslen(parsed[index]);
    if (length > kMaxArgumentBytes ||
        totalCharacters > kMaxTotalArgumentBytes - length)
      return false;
    totalCharacters += length;
    argv->emplace_back(parsed[index], length);
  }
  *cwd = std::move(rawCwd);
  *rawCommandLine = std::move(commandLine);
  return !argv->front().empty();
}

bool nativeX64Process(HANDLE process) {
  const HMODULE kernel = GetModuleHandleW(L"kernel32.dll");
  if (kernel == nullptr)
    return false;
  using IsWow64Process2Fn = BOOL(WINAPI *)(HANDLE, USHORT *, USHORT *);
  const auto isWow64Process2 = reinterpret_cast<IsWow64Process2Fn>(
      GetProcAddress(kernel, "IsWow64Process2"));
  if (isWow64Process2 == nullptr)
    return false;
  USHORT processMachine = IMAGE_FILE_MACHINE_UNKNOWN;
  USHORT nativeMachine = IMAGE_FILE_MACHINE_UNKNOWN;
  if (!isWow64Process2(process, &processMachine, &nativeMachine))
    return false;
  return processMachine == IMAGE_FILE_MACHINE_UNKNOWN &&
         nativeMachine == IMAGE_FILE_MACHINE_AMD64;
}

bool canonicalPathFromHandle(HANDLE handle, std::wstring *output) {
  DWORD needed = GetFinalPathNameByHandleW(
      handle, nullptr, 0, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  if (needed == 0 || needed > 32768)
    return false;
  std::wstring buffer(needed, L'\0');
  const DWORD written = GetFinalPathNameByHandleW(
      handle, buffer.data(), needed, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  if (written == 0 || written >= needed)
    return false;
  buffer.resize(written);
  *output = std::move(buffer);
  return true;
}

bool canonicalPath(const std::wstring &input, bool directory,
                   std::wstring *output) {
  const DWORD flags =
      directory ? FILE_FLAG_BACKUP_SEMANTICS : FILE_ATTRIBUTE_NORMAL;
  Handle handle(
      CreateFileW(input.c_str(), FILE_READ_ATTRIBUTES,
                  FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                  nullptr, OPEN_EXISTING, flags, nullptr));
  return handle.valid() && canonicalPathFromHandle(handle.value, output);
}

bool queryExecutablePath(HANDLE process, std::wstring *output) {
  std::wstring buffer(32768, L'\0');
  DWORD length = static_cast<DWORD>(buffer.size());
  if (!QueryFullProcessImageNameW(process, 0, buffer.data(), &length) ||
      length == 0)
    return false;
  buffer.resize(length);
  return canonicalPath(buffer, false, output);
}

bool isJavaName(const wchar_t *executableName) {
  return _wcsicmp(executableName, L"java.exe") == 0 ||
         _wcsicmp(executableName, L"javaw.exe") == 0;
}

bool isJavaPath(const std::wstring &path) {
  const std::size_t separator = path.find_last_of(L"\\/");
  return isJavaName(path.c_str() +
                    (separator == std::wstring::npos ? 0 : separator + 1U));
}

bool collectCandidate(DWORD pid, const std::wstring &currentSid,
                      ProcessEvidence *output, bool *belongsToOtherUser) {
  *belongsToOtherUser = false;
  Handle process(OpenProcess(
      PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, FALSE, pid));
  if (!process.valid())
    return false;
  ProcessIdentity before;
  if (!queryIdentity(process.value, pid, &before))
    return false;
  if (before.ownerSid != currentSid) {
    *belongsToOtherUser = true;
    return true;
  }
  if (!nativeX64Process(process.value))
    return false;
  ProcessEvidence evidence;
  evidence.identity = before;
  std::wstring rawCwdBefore;
  std::wstring rawCwdAfter;
  std::wstring rawCommandBefore;
  std::wstring rawCommandAfter;
  std::vector<std::wstring> argvBefore;
  std::vector<std::wstring> argvAfter;
  if (!queryExecutablePath(process.value, &evidence.executablePath) ||
      !isJavaPath(evidence.executablePath) ||
      !queryProcessParameters(process.value, &rawCwdBefore, &rawCommandBefore,
                              &argvBefore) ||
      !canonicalPath(rawCwdBefore, true, &evidence.canonicalCwd) ||
      !queryProcessParameters(process.value, &rawCwdAfter, &rawCommandAfter,
                              &argvAfter) ||
      rawCwdBefore != rawCwdAfter || rawCommandBefore != rawCommandAfter ||
      argvBefore != argvAfter)
    return false;
  evidence.rawCommandLine = std::move(rawCommandBefore);
  evidence.argv = std::move(argvBefore);
  ProcessIdentity after;
  if (!queryIdentity(process.value, pid, &after) ||
      !sameIdentity(before, after))
    return false;
  *output = std::move(evidence);
  return true;
}

bool enumerateJavaProcesses(const std::wstring &currentSid,
                            std::vector<ProcessEvidence> *output) {
  Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
  if (!snapshot.valid())
    return false;
  PROCESSENTRY32W entry{};
  entry.dwSize = static_cast<DWORD>(sizeof(entry));
  if (!Process32FirstW(snapshot.value, &entry))
    return false;
  output->clear();
  do {
    if (!isJavaName(entry.szExeFile))
      continue;
    ProcessEvidence evidence;
    bool otherUser = false;
    if (!collectCandidate(entry.th32ProcessID, currentSid, &evidence,
                          &otherUser))
      return false;
    if (!otherUser)
      output->push_back(std::move(evidence));
    if (output->size() > kMaxProcesses)
      return false;
  } while (Process32NextW(snapshot.value, &entry));
  if (GetLastError() != ERROR_NO_MORE_FILES)
    return false;
  std::sort(output->begin(), output->end(),
            [](const ProcessEvidence &left, const ProcessEvidence &right) {
              return left.identity.pid < right.identity.pid;
            });
  return true;
}

bool appendProcess(std::string *json, const ProcessEvidence &process) {
  json->append("{\"argvBase64\":[");
  std::size_t totalBytes = 0;
  for (std::size_t index = 0; index < process.argv.size(); ++index) {
    std::string utf8;
    if (!wideToUtf8(process.argv[index], &utf8) ||
        utf8.size() > kMaxArgumentBytes ||
        totalBytes > kMaxTotalArgumentBytes - utf8.size())
      return false;
    totalBytes += utf8.size();
    if (index != 0)
      json->push_back(',');
    json->push_back('"');
    json->append(base64(utf8));
    json->push_back('"');
  }
  json->append("],\"canonicalCwdBase64\":");
  if (!appendWideBase64(json, process.canonicalCwd, kMaxPathBytes))
    return false;
  json->append(",\"executablePathBase64\":");
  if (!appendWideBase64(json, process.executablePath, kMaxPathBytes))
    return false;
  json->append(",\"pid\":");
  json->append(std::to_string(process.identity.pid));
  json->append(",\"rawCommandLineBase64\":");
  if (!appendWideBase64(json, process.rawCommandLine, kMaxTotalArgumentBytes))
    return false;
  json->append(",\"startFileTime\":\"");
  json->append(decimal64(process.identity.creation));
  json->append("\"}");
  return true;
}

std::string commonEnvelope(const char *mode, const char *status,
                           const std::wstring &sid) {
  std::string sidUtf8;
  if (!wideToUtf8(sid, &sidUtf8))
    return {};
  std::string output = "{\"arch\":\"";
  output += kArch;
  output += "\",\"effectiveSid\":\"" + sidUtf8 + "\",\"mode\":\"" + mode +
            "\",\"platform\":\"" + kPlatform + "\",\"schema\":\"" + kSchema +
            "\",\"schemaVersion\":" + std::to_string(kSchemaVersion) +
            ",\"status\":\"" + status + "\"";
  return output;
}

void printUnknown(const char *mode, const std::wstring &sid, const char *reason,
                  unsigned port = 0) {
  std::string output = commonEnvelope(mode, "unknown", sid);
  if (output.empty())
    return;
  if (port != 0)
    output += ",\"port\":" + std::to_string(port);
  output += ",\"reason\":\"";
  output += reason;
  output += "\"}\n";
  std::fwrite(output.data(), 1, output.size(), stdout);
}

int runProcesses(const std::wstring &sid) {
  if (!supportedPebLayout()) {
    printUnknown("processes", sid, "process-evidence-unavailable");
    return 0;
  }
  std::vector<ProcessEvidence> processes;
  if (!enumerateJavaProcesses(sid, &processes)) {
    printUnknown("processes", sid, "process-evidence-unavailable");
    return 0;
  }
  std::string output = commonEnvelope("processes", "ok", sid);
  if (output.empty())
    return 1;
  output += ",\"processes\":[";
  for (std::size_t index = 0; index < processes.size(); ++index) {
    if (index != 0)
      output.push_back(',');
    if (!appendProcess(&output, processes[index])) {
      printUnknown("processes", sid, "output-limit-exceeded");
      return 0;
    }
    if (output.size() > kMaxJsonBytes) {
      printUnknown("processes", sid, "output-limit-exceeded");
      return 0;
    }
  }
  output += "]}\n";
  if (output.size() > kMaxJsonBytes) {
    printUnknown("processes", sid, "output-limit-exceeded");
    return 0;
  }
  std::fwrite(output.data(), 1, output.size(), stdout);
  return 0;
}

template <typename Table>
bool appendTcpTable(ULONG family, TCP_TABLE_CLASS tableClass, unsigned port,
                    std::set<DWORD> *pids) {
  DWORD size = 0;
  DWORD result =
      GetExtendedTcpTable(nullptr, &size, FALSE, family, tableClass, 0);
  if (result != ERROR_INSUFFICIENT_BUFFER || size == 0)
    return false;
  std::vector<unsigned char> storage(size);
  result =
      GetExtendedTcpTable(storage.data(), &size, FALSE, family, tableClass, 0);
  if (result != NO_ERROR || size < static_cast<DWORD>(sizeof(DWORD)))
    return false;
  const auto *table = reinterpret_cast<const Table *>(storage.data());
  if (table->dwNumEntries > static_cast<DWORD>(kMaxProcesses))
    return false;
  for (DWORD index = 0; index < table->dwNumEntries; ++index) {
    const auto &row = table->table[index];
    if (row.dwState == MIB_TCP_STATE_LISTEN &&
        static_cast<unsigned>(ntohs(static_cast<u_short>(row.dwLocalPort))) ==
            port) {
      if (row.dwOwningPid == 0)
        return false;
      pids->insert(row.dwOwningPid);
    }
  }
  return true;
}

bool tcpSnapshot(unsigned port, TcpSnapshot *output) {
  std::set<DWORD> pids;
  if (!appendTcpTable<MIB_TCPTABLE_OWNER_PID>(
          AF_INET, TCP_TABLE_OWNER_PID_LISTENER, port, &pids) ||
      !appendTcpTable<MIB_TCP6TABLE_OWNER_PID>(
          AF_INET6, TCP_TABLE_OWNER_PID_LISTENER, port, &pids))
    return false;
  output->pids = std::move(pids);
  return true;
}

bool listenerIdentities(const TcpSnapshot &snapshot,
                        std::vector<ProcessIdentity> *output) {
  output->clear();
  for (DWORD pid : snapshot.pids) {
    Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid));
    if (!process.valid())
      return false;
    ProcessIdentity before;
    ProcessIdentity after;
    if (!queryIdentity(process.value, pid, &before) ||
        !queryIdentity(process.value, pid, &after) ||
        !sameIdentity(before, after))
      return false;
    output->push_back(std::move(before));
  }
  return true;
}

bool bindExclusively(unsigned port, SocketHandle *ipv4, SocketHandle *ipv6) {
  ipv4->value = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  ipv6->value = socket(AF_INET6, SOCK_STREAM, IPPROTO_TCP);
  if (ipv4->value == INVALID_SOCKET || ipv6->value == INVALID_SOCKET)
    return false;
  BOOL exclusive = TRUE;
  DWORD ipv6Only = 1;
  if (setsockopt(ipv4->value, SOL_SOCKET, SO_EXCLUSIVEADDRUSE,
                 reinterpret_cast<const char *>(&exclusive),
                 static_cast<int>(sizeof(exclusive))) == SOCKET_ERROR ||
      setsockopt(ipv6->value, SOL_SOCKET, SO_EXCLUSIVEADDRUSE,
                 reinterpret_cast<const char *>(&exclusive),
                 static_cast<int>(sizeof(exclusive))) == SOCKET_ERROR ||
      setsockopt(ipv6->value, IPPROTO_IPV6, IPV6_V6ONLY,
                 reinterpret_cast<const char *>(&ipv6Only),
                 static_cast<int>(sizeof(ipv6Only))) == SOCKET_ERROR)
    return false;
  sockaddr_in address4{};
  address4.sin_family = AF_INET;
  address4.sin_addr.s_addr = htonl(INADDR_ANY);
  address4.sin_port = htons(static_cast<u_short>(port));
  sockaddr_in6 address6{};
  address6.sin6_family = AF_INET6;
  address6.sin6_addr = in6addr_any;
  address6.sin6_port = htons(static_cast<u_short>(port));
  return bind(ipv4->value, reinterpret_cast<const sockaddr *>(&address4),
              static_cast<int>(sizeof(address4))) != SOCKET_ERROR &&
         bind(ipv6->value, reinterpret_cast<const sockaddr *>(&address6),
              static_cast<int>(sizeof(address6))) != SOCKET_ERROR;
}

int runListener(const std::wstring &sid, unsigned port) {
  WSADATA winsockData{};
  WinsockSession winsock;
  if (WSAStartup(MAKEWORD(2, 2), &winsockData) != 0 ||
      LOBYTE(winsockData.wVersion) != 2 || HIBYTE(winsockData.wVersion) != 2) {
    printUnknown("listener", sid, "listener-network-stack-unavailable", port);
    return 0;
  }
  winsock.active = true;
  TcpSnapshot before;
  TcpSnapshot after;
  std::vector<ProcessIdentity> identities;
  if (!tcpSnapshot(port, &before) || !listenerIdentities(before, &identities) ||
      !tcpSnapshot(port, &after) || before.pids != after.pids) {
    printUnknown("listener", sid, "listener-evidence-unavailable", port);
    return 0;
  }
  for (const ProcessIdentity &identity : identities) {
    Handle process(
        OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, identity.pid));
    ProcessIdentity current;
    if (!process.valid() ||
        !queryIdentity(process.value, identity.pid, &current) ||
        !sameIdentity(identity, current)) {
      printUnknown("listener", sid, "listener-owner-identity-changed", port);
      return 0;
    }
  }
  const char *state = identities.empty() ? "absent" : "owners";
  SocketHandle ipv4;
  SocketHandle ipv6;
  if (identities.empty() && !bindExclusively(port, &ipv4, &ipv6)) {
    printUnknown("listener", sid, "listener-bind-probe-failed", port);
    return 0;
  }
  std::string output = commonEnvelope("listener", state, sid);
  if (output.empty())
    return 1;
  output += ",\"port\":" + std::to_string(port);
  if (!identities.empty()) {
    output += ",\"holders\":[";
    for (std::size_t index = 0; index < identities.size(); ++index) {
      if (index != 0)
        output.push_back(',');
      output += "{\"pid\":" + std::to_string(identities[index].pid) +
                ",\"startFileTime\":\"" +
                decimal64(identities[index].creation) + "\"}";
    }
    output += "],\"pids\":[";
    for (std::size_t index = 0; index < identities.size(); ++index) {
      if (index != 0)
        output.push_back(',');
      output += std::to_string(identities[index].pid);
    }
    output += "]";
  }
  output += "}\n";
  if (output.size() > kMaxJsonBytes) {
    printUnknown("listener", sid, "listener-evidence-unavailable", port);
    return 0;
  }
  std::fwrite(output.data(), 1, output.size(), stdout);
  return 0;
}

bool absoluteDosPath(const std::wstring &input, std::wstring *full,
                     std::wstring *ntPath) {
  if (input.empty() || input.find(L'\0') != std::wstring::npos ||
      input.size() > 32767)
    return false;
  if (input.size() < 3 ||
      !((input[0] >= L'A' && input[0] <= L'Z') ||
        (input[0] >= L'a' && input[0] <= L'z')) ||
      input[1] != L':' || (input[2] != L'\\' && input[2] != L'/'))
    return false;
  DWORD needed = GetFullPathNameW(input.c_str(), 0, nullptr, nullptr);
  if (needed == 0 || needed > 32768)
    return false;
  std::wstring buffer(needed, L'\0');
  DWORD written =
      GetFullPathNameW(input.c_str(), needed, buffer.data(), nullptr);
  if (written == 0 || written >= needed)
    return false;
  buffer.resize(written);
  if (buffer.size() < 3 ||
      !((buffer[0] >= L'A' && buffer[0] <= L'Z') ||
        (buffer[0] >= L'a' && buffer[0] <= L'z')) ||
      buffer[1] != L':' || buffer[2] != L'\\')
    return false;
  for (wchar_t &character : buffer) {
    if (character == L'/')
      character = L'\\';
  }
  *full = buffer;
  *ntPath = L"\\??\\" + buffer;
  return true;
}

enum class SecureOpenResult { ok, reparse, failed };

SecureOpenResult openSecureNoReparse(const std::wstring &ntPath,
                                     Handle *output) {
  const HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (ntdll == nullptr)
    return SecureOpenResult::failed;
  const auto create =
      reinterpret_cast<NtCreateFileFn>(GetProcAddress(ntdll, "NtCreateFile"));
  if (create == nullptr || ntPath.size() > USHRT_MAX / sizeof(wchar_t))
    return SecureOpenResult::failed;
  UNICODE_STRING name{};
  name.Buffer = const_cast<PWSTR>(ntPath.c_str());
  name.Length = static_cast<USHORT>(ntPath.size() * sizeof(wchar_t));
  name.MaximumLength = name.Length;
  OBJECT_ATTRIBUTES attributes{};
  attributes.Length = static_cast<ULONG>(sizeof(attributes));
  attributes.ObjectName = &name;
  attributes.Attributes = kObjCaseInsensitive | kObjDontReparse;
  IO_STATUS_BLOCK statusBlock{};
  HANDLE raw = INVALID_HANDLE_VALUE;
  const LONG status =
      create(&raw, FILE_GENERIC_READ | READ_CONTROL | SYNCHRONIZE, &attributes,
             &statusBlock, nullptr, FILE_ATTRIBUTE_NORMAL, 0, kFileOpen,
             kFileNonDirectoryFile | kFileSynchronousIoNonalert |
                 kFileOpenReparsePoint,
             nullptr, 0);
  if (status == kStatusReparsePointEncountered)
    return SecureOpenResult::reparse;
  if (!isSuccess(status) || raw == INVALID_HANDLE_VALUE || raw == nullptr)
    return SecureOpenResult::failed;
  output->reset(raw);
  return SecureOpenResult::ok;
}

bool fileIdentity(HANDLE file, FileIdentity *output) {
  BY_HANDLE_FILE_INFORMATION info{};
  FILE_ID_INFO fileId{};
  if (!GetFileInformationByHandle(file, &info) ||
      (info.dwFileAttributes &
       (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT |
        FILE_ATTRIBUTE_DEVICE)) != 0 ||
      GetFileType(file) != FILE_TYPE_DISK ||
      !GetFileInformationByHandleEx(file, FileIdInfo, &fileId,
                                    static_cast<DWORD>(sizeof(fileId))))
    return false;
  FileIdentity value;
  value.volumeSerial = fileId.VolumeSerialNumber;
  value.fileId = fileId.FileId;
  value.size.HighPart = info.nFileSizeHigh;
  value.size.LowPart = info.nFileSizeLow;
  value.lastWrite = info.ftLastWriteTime;
  *output = value;
  return true;
}

bool sameFileIdentity(const FileIdentity &left, const FileIdentity &right) {
  return left.volumeSerial == right.volumeSerial &&
         std::memcmp(left.fileId.Identifier, right.fileId.Identifier,
                     sizeof(left.fileId.Identifier)) == 0 &&
         left.size.QuadPart == right.size.QuadPart &&
         equalFileTime(left.lastWrite, right.lastWrite);
}

bool allowedAclSid(PSID candidate, PSID owner, PSID systemSid,
                   PSID administratorsSid) {
  return EqualSid(candidate, owner) || EqualSid(candidate, systemSid) ||
         EqualSid(candidate, administratorsSid);
}

// Private-DACL rule: the DACL must be present and non-null, the file owner must
// be the invoking token user, and every access-allow ACE must name only that
// user, LocalSystem, or BUILTIN\\Administrators. Object/callback/unknown ACEs
// fail closed. Deny ACEs do not grant access and are accepted. Consequently no
// Everyone, Users, Authenticated Users, app-package, service, or other account
// can receive read or write permission through this file's DACL.
bool privateCurrentUserDacl(HANDLE file, PSID currentSid,
                            std::vector<unsigned char> *descriptorBytes) {
  PSID owner = nullptr;
  PACL dacl = nullptr;
  PSECURITY_DESCRIPTOR rawDescriptor = nullptr;
  const DWORD result =
      GetSecurityInfo(file, SE_FILE_OBJECT,
                      OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                      &owner, nullptr, &dacl, nullptr, &rawDescriptor);
  LocalSecurityDescriptor descriptor;
  descriptor.value = rawDescriptor;
  if (result != ERROR_SUCCESS || rawDescriptor == nullptr || owner == nullptr ||
      !IsValidSid(owner) || !EqualSid(owner, currentSid) || dacl == nullptr ||
      !IsValidAcl(dacl))
    return false;
  const DWORD descriptorLength = GetSecurityDescriptorLength(rawDescriptor);
  if (descriptorLength == 0 || descriptorLength > 64U * 1024U)
    return false;
  SID_IDENTIFIER_AUTHORITY ntAuthority = SECURITY_NT_AUTHORITY;
  PSID systemSid = nullptr;
  PSID administratorsSid = nullptr;
  if (!AllocateAndInitializeSid(&ntAuthority, 1, SECURITY_LOCAL_SYSTEM_RID, 0,
                                0, 0, 0, 0, 0, 0, &systemSid) ||
      !AllocateAndInitializeSid(&ntAuthority, 2, SECURITY_BUILTIN_DOMAIN_RID,
                                DOMAIN_ALIAS_RID_ADMINS, 0, 0, 0, 0, 0, 0,
                                &administratorsSid)) {
    if (systemSid != nullptr)
      FreeSid(systemSid);
    if (administratorsSid != nullptr)
      FreeSid(administratorsSid);
    return false;
  }
  bool valid = true;
  for (DWORD index = 0; index < static_cast<DWORD>(dacl->AceCount); ++index) {
    void *rawAce = nullptr;
    if (!GetAce(dacl, index, &rawAce) || rawAce == nullptr) {
      valid = false;
      break;
    }
    const auto *header = static_cast<const ACE_HEADER *>(rawAce);
    if (header->AceType == ACCESS_DENIED_ACE_TYPE)
      continue;
    if (header->AceType != ACCESS_ALLOWED_ACE_TYPE ||
        header->AceSize < static_cast<WORD>(sizeof(ACCESS_ALLOWED_ACE))) {
      valid = false;
      break;
    }
    const auto *ace = static_cast<const ACCESS_ALLOWED_ACE *>(rawAce);
    PSID aceSid = const_cast<DWORD *>(&ace->SidStart);
    if (!IsValidSid(aceSid) ||
        !allowedAclSid(aceSid, currentSid, systemSid, administratorsSid)) {
      valid = false;
      break;
    }
  }
  FreeSid(systemSid);
  FreeSid(administratorsSid);
  if (valid) {
    const auto *begin = static_cast<const unsigned char *>(rawDescriptor);
    descriptorBytes->assign(begin, begin + descriptorLength);
  }
  return valid;
}

bool readWholeFileTwice(HANDLE file, DWORD size,
                        std::vector<unsigned char> *output) {
  auto readOnce = [&](std::vector<unsigned char> *bytes) {
    LARGE_INTEGER zero{};
    if (!SetFilePointerEx(file, zero, nullptr, FILE_BEGIN))
      return false;
    bytes->assign(size, 0);
    DWORD offset = 0;
    while (offset < size) {
      DWORD count = 0;
      if (!ReadFile(file, bytes->data() + offset, size - offset, &count,
                    nullptr) ||
          count == 0)
        return false;
      offset += count;
    }
    unsigned char extra = 0;
    DWORD extraCount = 0;
    return ReadFile(file, &extra, 1, &extraCount, nullptr) && extraCount == 0;
  };
  std::vector<unsigned char> first;
  std::vector<unsigned char> second;
  if (!readOnce(&first) || !readOnce(&second) || first != second)
    return false;
  *output = std::move(first);
  return true;
}

int runSecureFile(const std::wstring &sid, PSID currentSid,
                  const std::wstring &path, DWORD maximumBytes) {
  std::wstring fullPath;
  std::wstring ntPath;
  if (!absoluteDosPath(path, &fullPath, &ntPath)) {
    printUnknown("secure-file", sid, "secure-file-invalid-path");
    return 0;
  }
  Handle file;
  const SecureOpenResult opened = openSecureNoReparse(ntPath, &file);
  if (opened != SecureOpenResult::ok) {
    printUnknown("secure-file", sid,
                 opened == SecureOpenResult::reparse
                     ? "secure-file-reparse"
                     : "secure-file-open-failed");
    return 0;
  }
  FileIdentity before;
  std::wstring canonicalFilePath;
  if (!fileIdentity(file.value, &before) ||
      !canonicalPathFromHandle(file.value, &canonicalFilePath)) {
    printUnknown("secure-file", sid, "secure-file-not-regular");
    return 0;
  }
  if (before.size.QuadPart > maximumBytes || before.size.HighPart != 0) {
    printUnknown("secure-file", sid, "secure-file-too-large");
    return 0;
  }
  std::vector<unsigned char> securityBefore;
  if (!privateCurrentUserDacl(file.value, currentSid, &securityBefore)) {
    printUnknown("secure-file", sid, "secure-file-not-private");
    return 0;
  }
  std::vector<unsigned char> bytes;
  if (!readWholeFileTwice(file.value, before.size.LowPart, &bytes)) {
    printUnknown("secure-file", sid, "secure-file-read-failed");
    return 0;
  }
  FileIdentity after;
  std::vector<unsigned char> securityAfter;
  if (!fileIdentity(file.value, &after) || !sameFileIdentity(before, after) ||
      !privateCurrentUserDacl(file.value, currentSid, &securityAfter) ||
      securityBefore != securityAfter) {
    printUnknown("secure-file", sid, "secure-file-identity-changed");
    return 0;
  }
  std::string output = commonEnvelope("secure-file", "ok", sid);
  if (output.empty())
    return 1;
  std::string raw;
  if (!bytes.empty())
    raw.assign(reinterpret_cast<const char *>(bytes.data()), bytes.size());
  output += ",\"bytesBase64\":\"" + base64(raw) + "\",\"canonicalPathBase64\":";
  if (!appendWideBase64(&output, canonicalFilePath, kMaxPathBytes)) {
    printUnknown("secure-file", sid, "output-limit-exceeded");
    return 0;
  }
  output += ",\"fileId\":\"" + fileIdHex(before.fileId) +
            "\",\"maxBytes\":" + std::to_string(maximumBytes) +
            ",\"size\":" + decimal64(before.size) +
            ",\"volumeSerialNumber\":\"" +
            decimalUnsigned(before.volumeSerial) + "\"}\n";
  if (output.size() > kMaxJsonBytes) {
    printUnknown("secure-file", sid, "output-limit-exceeded");
    return 0;
  }
  std::fwrite(output.data(), 1, output.size(), stdout);
  return 0;
}

bool parsePort(const wchar_t *value, unsigned *output) {
  if (value == nullptr || *value == L'\0')
    return false;
  wchar_t *end = nullptr;
  errno = 0;
  const unsigned long parsed = std::wcstoul(value, &end, 10);
  if (errno != 0 || end == value || *end != L'\0' || parsed < 1 ||
      parsed > 65535)
    return false;
  *output = static_cast<unsigned>(parsed);
  return true;
}

bool parseMaximumBytes(const wchar_t *value, DWORD *output) {
  if (value == nullptr || *value == L'\0')
    return false;
  wchar_t *end = nullptr;
  errno = 0;
  const unsigned long parsed = std::wcstoul(value, &end, 10);
  if (errno != 0 || end == value || *end != L'\0' || parsed < 1 ||
      parsed > kAbsoluteMaxSecureFileBytes)
    return false;
  *output = static_cast<DWORD>(parsed);
  return true;
}

int runSelfTest() {
  constexpr char output[] =
      "{\"arch\":\"x64\",\"mode\":\"self-test\",\"platform\":\"win32\","
      "\"schema\":\"qortium-core-observer\",\"schemaVersion\":1,\"status\":"
      "\"ok\"}\n";
  std::fwrite(output, 1, sizeof(output) - 1U, stdout);
  return 0;
}

} // namespace

int wmain(int argc, wchar_t **argv) {
#if !defined(_WIN64) || !defined(_M_X64)
#error "The Windows Qortium Core observer must be built for Windows x64."
#endif
  if (!SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32))
    return 1;
  if (argc == 2 && std::wcscmp(argv[1], L"self-test") == 0)
    return runSelfTest();

  std::vector<unsigned char> currentSid;
  std::wstring currentSidText;
  if (!currentTokenSid(&currentSid, &currentSidText))
    return 1;
  if (argc == 2 && std::wcscmp(argv[1], L"processes") == 0)
    return runProcesses(currentSidText);
  if (argc == 4 && std::wcscmp(argv[1], L"listener") == 0 &&
      std::wcscmp(argv[2], L"--port") == 0) {
    unsigned port = 0;
    if (!parsePort(argv[3], &port))
      return 1;
    return runListener(currentSidText, port);
  }
  if (argc == 6 && std::wcscmp(argv[1], L"secure-file") == 0 &&
      std::wcscmp(argv[2], L"--path") == 0 &&
      std::wcscmp(argv[4], L"--max-bytes") == 0) {
    DWORD maximumBytes = 0;
    if (!parseMaximumBytes(argv[5], &maximumBytes))
      return 1;
    return runSecureFile(currentSidText, currentSid.data(), argv[3],
                         maximumBytes);
  }
  return 1;
}
