const net = require('net')

const MinecraftProtocol = require('./protocol')
const MinecraftBufferReader = require('./reader')

class MinecraftServer {
	constructor (host, port) {
		this.host = host
		this.port = port
	}

	ping (timeout, protocolVersion, callback) {
		const socket = net.createConnection({
			host: this.host,
			port: this.port
		})

		// #setNoDelay instantly flushes data during read/writes
		// This prevents the runtime from delaying the write at all
		socket.setNoDelay(true)

		let didConnect = false

		socket.on('connect', () => {
			didConnect = true

			const handshake = MinecraftProtocol.withLength([
				MinecraftProtocol.writeVarInt(0),
				MinecraftProtocol.writeVarInt(protocolVersion),
				MinecraftProtocol.writeVarInt(this.host.length),
				MinecraftProtocol.writeString(this.host),
				MinecraftProtocol.writeUShort(this.port),
				MinecraftProtocol.writeVarInt(1)
			])

			socket.write(handshake)

			const request = MinecraftProtocol.withLength([
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
				} catch (err) {
					// Safely propagate JSON parse errors to the callback
					callback(err)
				}
			} else {
				callback(new Error('Received malformed reply'))
			}

			// Close the socket
			socket.destroy()
		})

		socket.on('error', (err) => {
			callback(err)

			// Close the socket
			socket.destroy()
		})

		socket.setTimeout(timeout, () => {
			callback(new Error('Read timeout'))

			// Close the socket
			socket.destroy()
		})

		// Set a manual timeout interval
		// This ensures the connection will NEVER hang regardless of internal state
		setTimeout(() => {
			if (!didConnect || socket.connecting) {
				socket.emit('error', new Error('Connection timeout'))
			} else if (incomingBuffer.length === 0) {
				// Some Minecraft servers may sinkhole pings and will never reply
				socket.emit('error', new Error('No reply within timeout'))
			} else if (!socket.destroyed) {
				// Make sure the socket is always destroyed
				socket.emit('error', new Error('Socket not closed'))
			}
		}, timeout)
	}
}

module.exports = MinecraftServer