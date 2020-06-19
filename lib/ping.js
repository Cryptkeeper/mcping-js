const net = require('net')

const MinecraftProtocol = require('./protocol')
const MinecraftBufferReader = require('./reader')

class MinecraftServer {
  constructor (host, port) {
    this.host = host
    this.port = port || 25565
  }

  ping (timeout, protocolVersion, callback) {
    const socket = net.createConnection({
      host: this.host,
      port: this.port
    })

    // Set a manual timeout interval
    // This ensures the connection will NEVER hang regardless of internal state
    const timeoutTask = setTimeout(() => {
      socket.emit('error', new Error('Socket timeout'))
    }, timeout)

    const closeSocket = () => {
      socket.destroy()

      // Prevent the timeout task from running
      clearTimeout(timeoutTask)
    }

    // Generic error handler
    // This protects multiple error callbacks given the complex socket state
    // This is mostly dangerous since it can swallow errors
    let didFireError = false

    const handleErr = (err) => {
      // Always attempt to destroy the socket
      closeSocket()

      if (!didFireError) {
        didFireError = true

        // Push the err into the callback
        callback(err)
      }
    }

    // #setNoDelay instantly flushes data during read/writes
    // This prevents the runtime from delaying the write at all
    socket.setNoDelay(true)

    socket.on('connect', () => {
      const handshake = MinecraftProtocol.concat([
        MinecraftProtocol.writeVarInt(0),
        MinecraftProtocol.writeVarInt(protocolVersion),
        MinecraftProtocol.writeVarInt(this.host.length),
        MinecraftProtocol.writeString(this.host),
        MinecraftProtocol.writeUShort(this.port),
        MinecraftProtocol.writeVarInt(1)
      ])

      socket.write(handshake)

      const request = MinecraftProtocol.concat([
        MinecraftProtocol.writeVarInt(0)
      ])

      socket.write(request)
    })
    
    let incomingBuffer = Buffer.alloc(0)

    socket.on('data', data => {
      incomingBuffer = Buffer.concat([incomingBuffer, data])

      // Wait until incomingBuffer is at least 5 bytes long to ensure it has captured the first VarInt value
      // This value is used to determine the full read length of the response
      // "VarInts are never longer than 5 bytes"
      // https://wiki.vg/Data_types#VarInt_and_VarLong
      if (incomingBuffer.length < 5) {
        return
      }

      // Always allocate a new MinecraftBufferReader, even if the operation fails
      // It tracks the read offset so a new allocation ensures it is reset
      const bufferReader = new MinecraftBufferReader(incomingBuffer)

      const length = bufferReader.readVarInt()

      // Ensure incomingBuffer contains the full response
      // Offset incomingBuffer.length by bufferReader#offset since length does not include itself
      if (incomingBuffer.length - bufferReader.offset() < length) {
        return
      }

      // Validate the incoming packet ID is a response
      const id = bufferReader.readVarInt()

      if (id === 0) {
        const reply = bufferReader.readString()

        try {
          const message = JSON.parse(reply)

          callback(null, message)

          // Close the socket and clear the timeout task
          // This is a general cleanup for success conditions
          closeSocket()
        } catch (err) {
          // Safely propagate JSON parse errors to the callback
          handleErr(err)
        }
      } else {
        handleErr(new Error('Received unexpected packet'))
      }
    })

    socket.on('error', handleErr)
  }
}

module.exports = MinecraftServer