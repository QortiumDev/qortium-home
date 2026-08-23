export const I2PD_SAM_MAX_REPLY_BYTES = 512

export function isValidI2pdSamHelloReplyLine(value: Buffer) {
  if (value.byteLength < 1 || value.byteLength > I2PD_SAM_MAX_REPLY_BYTES) return false
  const line = value.at(-1) === 0x0d ? value.subarray(0, -1) : value
  return line.byteLength > 0 && line.every((byte) => byte >= 0x20 && byte <= 0x7e) &&
    /^HELLO REPLY RESULT=OK VERSION=3\.[0-3]$/.test(line.toString('ascii'))
}
