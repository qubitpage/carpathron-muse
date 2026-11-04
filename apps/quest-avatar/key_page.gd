extends Node
## Carpathron Avatar 1.6 — put the Meta API key into the headset from your phone or PC (typing a long key in VR is
## slow). While the "Meta AI" settings page is open, the headset serves one small page on your Wi-Fi:
## http://<headset-ip>:8777 — paste the key there with the 4-digit code shown in the headset. Only that code
## is accepted, the page stops when you leave the settings, and the key is stored only in this headset.

signal got_key(key: String)

const PORT := 8777
var server: TCPServer
var code := ""
var clients: Array = []
var running := false

func start() -> void:
	if running:
		return
	server = TCPServer.new()
	if server.listen(PORT) != OK:
		return
	code = "%04d" % (randi() % 10000)
	running = true

func stop() -> void:
	if not running:
		return
	server.stop()
	for c in clients:
		(c["peer"] as StreamPeerTCP).disconnect_from_host()
	clients.clear()
	running = false

func url() -> String:
	for a in IP.get_local_addresses():
		var s := str(a)
		if s.begins_with("192.168.") or s.begins_with("10.") or s.begins_with("172."):
			return "http://%s:%d" % [s, PORT]
	return ""

func _process(_dt: float) -> void:
	if not running:
		return
	while server.is_connection_available():
		clients.append({"peer": server.take_connection(), "buf": PackedByteArray(), "t": Time.get_ticks_msec()})
	for c in clients.duplicate():
		var p: StreamPeerTCP = c["peer"]
		p.poll()
		if p.get_status() != StreamPeerTCP.STATUS_CONNECTED or Time.get_ticks_msec() - int(c["t"]) > 8000:
			clients.erase(c)
			continue
		var n := p.get_available_bytes()
		if n > 0:
			var r := p.get_data(n)
			if r[0] == OK:
				(c["buf"] as PackedByteArray).append_array(r[1])
		var text := (c["buf"] as PackedByteArray).get_string_from_utf8()
		var he := text.find("\r\n\r\n")
		if he < 0:
			continue
		var head := text.substr(0, he)
		var body := text.substr(he + 4)
		var clen := 0
		for line in head.split("\r\n"):
			if line.to_lower().begins_with("content-length:"):
				clen = int(line.substr(15).strip_edges())
		if body.to_utf8_buffer().size() < clen:
			continue
		var msg := ""
		if head.begins_with("POST"):
			var form := {}
			for kv in body.split("&"):
				var i := kv.find("=")
				if i > 0:
					form[kv.substr(0, i)] = kv.substr(i + 1).replace("+", " ").uri_decode().strip_edges()
			if str(form.get("code", "")) != code:
				msg = "<p class=bad>Wrong code. Look at the code in the headset.</p>"
			elif str(form.get("key", "")).length() < 10:
				msg = "<p class=bad>That doesn't look like a key.</p>"
			else:
				got_key.emit(str(form["key"]))
				msg = "<p class=ok>✓ The key is in the headset. You can close this page.</p>"
		var html := """<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Carpathron Avatar</title><style>body{font-family:system-ui,sans-serif;background:#0e1117;color:#eef;margin:0;padding:24px;max-width:520px}
h1{font-size:22px}input{width:100%;box-sizing:border-box;padding:12px;margin:6px 0 14px;border-radius:10px;border:1px solid #333;background:#171b22;color:#fff;font-size:16px}
button{padding:12px 20px;border:0;border-radius:10px;background:#ff8f28;color:#111;font-weight:700;font-size:16px}.ok{color:#6c6}.bad{color:#f77}p{color:#aab}</style></head>
<body><h1>Carpathron Avatar — Meta API key</h1><p>The key goes only into your headset (on this Wi-Fi) so Carpathron can use Meta's models without the PC.</p>%s
<form method=post><label>Code shown in the headset</label><input name=code inputmode=numeric autocomplete=off>
<label>Meta API key</label><input name=key type=password autocomplete=off><button>Send to the headset</button></form></body></html>""" % msg
		var out := html.to_utf8_buffer()
		p.put_data(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: %d\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n" % out.size()).to_utf8_buffer())
		p.put_data(out)
		p.disconnect_from_host()
		clients.erase(c)
