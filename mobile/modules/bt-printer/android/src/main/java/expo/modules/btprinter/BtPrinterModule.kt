package expo.modules.btprinter

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

/**
 * Sends raw ESC/POS bytes to a Bluetooth receipt printer that is already
 * paired with the phone (Android's own Bluetooth settings), over the classic
 * serial-port profile every 58/80 mm thermal printer speaks. No print dialog:
 * this is what lets a new order print by itself (owner, 2026-10-09).
 *
 * The ticket itself is rendered on the server (`ticket-escpos.ts`); this
 * module only opens the socket, writes the bytes in chunks and closes it.
 * Every function runs off the main thread (Expo's AsyncFunction queue).
 */
class BtPrinterModule : Module() {
  private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

  private fun adapter(): BluetoothAdapter? {
    val context = appContext.reactContext ?: return null
    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    return manager?.adapter
  }

  private fun open(adapter: BluetoothAdapter, address: String): BluetoothSocket {
    val device = adapter.getRemoteDevice(address)
    // Secure RFCOMM first; many cheap printers only accept the insecure one.
    try {
      val socket = device.createRfcommSocketToServiceRecord(sppUuid)
      socket.connect()
      return socket
    } catch (first: Exception) {
      val socket = device.createInsecureRfcommSocketToServiceRecord(sppUuid)
      socket.connect()
      return socket
    }
  }

  override fun definition() = ModuleDefinition {
    Name("BtPrinter")

    Function("isAvailable") { adapter() != null }

    Function("isEnabled") { adapter()?.isEnabled == true }

    AsyncFunction("listPaired") {
      val adapter = adapter() ?: return@AsyncFunction emptyList<Map<String, String>>()
      try {
        adapter.bondedDevices.map { device ->
          mapOf("name" to (device.name ?: device.address), "address" to device.address)
        }
      } catch (e: SecurityException) {
        throw CodedException("ERR_PERMISSION", "Bluetooth permission missing", e)
      }
    }

    AsyncFunction("print") { address: String, base64: String ->
      val adapter = adapter() ?: throw CodedException("ERR_NO_BLUETOOTH", "No Bluetooth on this device", null)
      if (!adapter.isEnabled) throw CodedException("ERR_BLUETOOTH_OFF", "Bluetooth is switched off", null)
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      var socket: BluetoothSocket? = null
      try {
        socket = open(adapter, address)
        val out = socket.outputStream
        // Small chunks with a breath between them: a printer with a tiny
        // buffer drops bytes (and prints garbage) when flooded.
        var offset = 0
        while (offset < bytes.size) {
          val end = minOf(offset + 512, bytes.size)
          out.write(bytes, offset, end - offset)
          out.flush()
          offset = end
          Thread.sleep(20)
        }
        // Let the printer drain before the link drops.
        Thread.sleep(400)
        true
      } catch (e: SecurityException) {
        throw CodedException("ERR_PERMISSION", "Bluetooth permission missing", e)
      } catch (e: CodedException) {
        throw e
      } catch (e: Exception) {
        throw CodedException("ERR_PRINT", e.message ?: "Printing failed", e)
      } finally {
        try {
          socket?.close()
        } catch (_: Exception) {
        }
      }
    }
  }
}
