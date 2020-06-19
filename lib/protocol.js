class MinecraftProtocol {
  static writeVarInt (val) {
    // "VarInts are never longer than 5 bytes"
    // https://wiki.vg/Data_types#VarInt_and_VarLong
    const buf = Buffer.alloc(5)
    let written = 0

    while (true) {
      if ((val & 0xFFFFFF80) === 0) {
        buf.writeUInt8(val, written++)
        break
      } else {
        buf.writeUInt8(val & 0x7F | 0x80, written++)
        val >>>= 7
      }
    }

    return buf.slice(0, written)
  }

  static writeString (val) {
    return Buffer.from(val, 'UTF-8')
  }

  static writeUShort (val) {
    return Buffer.from([val >> 8, val & 0xFF])
  }

  static concat (chunks) {
    let length = 0

    for (const chunk of chunks) {
      length += chunk.length
    }

    const buf = [
      MinecraftProtocol.writeVarInt(length),
      ...chunks
    ]

    return Buffer.concat(buf)
  }
}

module.exports = MinecraftProtocol