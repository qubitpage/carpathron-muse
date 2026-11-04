extends Node3D
## Carpathron Avatar 1.2 — the cockpit around the robot's camera screen:
##   dashboard above the screen  : distance ahead (bar: green / yellow / red), lean, side eyes, what the car felt
##   warning in front of you     : BUMP / STEP / DROP / BLOCKED / SENSOR LINK LOST for 2 s (+ the controllers buzz)
##   mini-map on the left        : the room map Muse Carpathron learned (free floor, walls and furniture), the robot,
##                                 objects the camera named, places, steps / drops / bumps, the planned way
##   help card on the right      : 1.3 — missions, robots, training room and exit are in the MENU (Menu button)
## Everything here comes from the car's /status (sensors) and Muse Carpathron on the PC (map + missions).

const MAP_SIZE := 1.0           # metres: the longer side of the mini-map in the headset
const ITEMS_BASE := [
	["explore", "", "Explore the room by itself"],
	["scan", "", "Scan with photos (names the objects)"],
	["measure", "", "Measure all around here"],
]

var dash: Label3D
var bar_bg: MeshInstance3D
var bar: MeshInstance3D
var bar_mat: StandardMaterial3D
var warn: Label3D
var warn_until := 0
var map_quad: MeshInstance3D
var map_mat: StandardMaterial3D
var map_title: Label3D
var map_labels: Node3D
var news: Label3D
var menu: Label3D
var menu_open := false
var sel := 0
var items: Array = []           # [action, name, text]
var _map: Dictionary = {}
var _pose: Dictionary = {}
var _bytes := PackedByteArray()
var _base: Image = null          # the room without the robot (rebuilt when a new map arrives)
var _tex: ImageTexture = null
var _demo := false
var _vr := false
var dash_root: Node3D   # dashboard + distance bar + warning: shrunk towards you in the VR view

func _ready() -> void:
	dash = _label(Vector3(-1.6, 1.38, -2.15), 0.0024, 40, Color(0.9, 0.93, 0.97))
	dash.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	dash.width = 1650
	bar_bg = _quad(Vector2(1.0, 0.05), Color(0.12, 0.14, 0.18))
	bar_bg.position = Vector3(1.05, 1.3, -2.16)
	add_child(bar_bg)
	bar = _quad(Vector2(1.0, 0.05), Color(0.2, 0.8, 0.45))
	bar_mat = bar.material_override
	bar.position = Vector3(1.05, 1.3, -2.155)
	add_child(bar)
	warn = _label(Vector3(0, 0.55, -2.0), 0.004, 96, Color(1, 0.3, 0.3))
	warn.outline_size = 28
	warn.outline_modulate = Color(0.08, 0.02, 0.02)
	warn.visible = false
	dash_root = Node3D.new()
	add_child(dash_root)
	for n in [dash, bar_bg, bar, warn]:
		n.reparent(dash_root, false)
	# mini-map (left)
	map_quad = MeshInstance3D.new()
	var q := QuadMesh.new(); q.size = Vector2(MAP_SIZE, MAP_SIZE)
	map_quad.mesh = q
	map_mat = StandardMaterial3D.new()
	map_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	map_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	map_mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	map_quad.material_override = map_mat
	map_quad.position = Vector3(-1.55, -0.05, -1.35)   # 1.3: closer and turned to you, readable
	map_quad.rotation_degrees = Vector3(0, 48, 0)
	map_quad.layers = 2
	add_child(map_quad)
	map_labels = Node3D.new()
	map_quad.add_child(map_labels)
	map_title = _label(Vector3(0, MAP_SIZE / 2 + 0.07, 0.01), 0.0021, 44, Color(1.0, 0.7, 0.28))
	map_title.text = "ROOM MAP"
	remove_child(map_title); map_quad.add_child(map_title)
	news = _label(Vector3(0, -MAP_SIZE / 2 - 0.16, 0.01), 0.002, 38, Color(0.88, 0.9, 0.94))
	news.width = 560
	news.vertical_alignment = VERTICAL_ALIGNMENT_TOP
	news.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	remove_child(news); map_quad.add_child(news)
	# missions (right)
	menu = _label(Vector3(1.55, -0.05, -1.35), 0.0021, 40, Color(0.92, 0.93, 0.95))   # 1.3: the help card
	menu.rotation_degrees = Vector3(0, -48, 0)
	menu.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	menu.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	menu.width = 600
	menu.outline_size = 12
	menu.outline_modulate = Color(0.04, 0.05, 0.07, 0.95)
	_build_items({})
	_draw_menu()
	set_map({})

func _label(pos: Vector3, px: float, size: int, col: Color) -> Label3D:
	var l := Label3D.new()
	l.position = pos
	l.pixel_size = px
	l.font_size = size
	l.modulate = col
	l.outline_size = 10
	l.outline_modulate = Color(0.04, 0.05, 0.07, 0.9)
	l.layers = 2
	add_child(l)
	return l

func _quad(size: Vector2, col: Color) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	var q := QuadMesh.new(); q.size = size
	m.mesh = q
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = col
	m.material_override = mat
	m.layers = 2
	return m

## 1.3 VR view: the picture wraps around you (2 m away), so the dashboard comes closer (same look, 62 %)
## and the map / help cards step aside, just outside the picture
func set_vr(on: bool) -> void:
	_vr = on
	dash_root.scale = Vector3.ONE * (0.62 if on else 1.0)
	# the room map (left) and the help card (right) sit just outside the VR picture: turn your head to read them
	var ang := deg_to_rad(64.0 if on else 48.0)
	var d := 1.45 if on else 1.9
	map_quad.position = Vector3(-sin(ang) * d, -0.05, -cos(ang) * d)
	map_quad.rotation.y = ang
	menu.position = Vector3(sin(ang) * d, -0.05, -cos(ang) * d)
	menu.rotation.y = -ang
	map_quad.visible = not _demo
	menu.visible = not _demo

## the demo robot has no sensors / map: hide the cockpit
func set_demo(on: bool) -> void:
	_demo = on
	for n in [dash, bar_bg, bar, map_quad, menu]:
		n.visible = not on
	if on:
		warn.visible = false

# ------------------------------------------------------------------ dashboard
static func _cm(mm) -> String:
	var v := int(mm)
	return "clear" if v <= 0 else "%d cm" % int(round(v / 10.0))

func update_dash(s: Dictionary, online: bool) -> void:
	if _demo:
		return
	if not online:
		dash.text = "ROBOT OFFLINE"
		bar.visible = false
		return
	if s.is_empty():
		dash.text = "No sensor data (car firmware 2.x shows distance, lean and what the car feels)"
		bar.visible = false
		return
	var stop := int(s.get("stopMm", 150))
	var d := int(s.get("dist", -1))
	var parts: Array = []
	if bool(s.get("linkLost", false)):
		parts.append("SENSOR LINK LOST - forward blocked")
	elif bool(s.get("tof", false)):
		parts.append("AHEAD %s" % _cm(d))
	else:
		parts.append("NO DISTANCE SENSOR")
	if bool(s.get("sideEyes", false)):
		parts.append("L %s  R %s" % [_cm(s.get("sideL", -1)), _cm(s.get("sideR", -1))])
	if s.get("lean", null) != null:
		parts.append("lean %.1f deg" % float(s.get("lean")))
	if bool(s.get("cliffSensor", false)):
		parts.append("NO FLOOR!" if bool(s.get("cliff", false)) else "floor ok")
	if s.has("bumps"):
		parts.append("felt: %d bumps · %d steps · %d drops" % [int(s.get("bumps", 0)), int(s.get("tiltStops", 0)), int(s.get("cliffStops", 0))])
	if bool(s.get("blocked", false)):
		parts.append("BLOCKED")
	dash.text = "   ".join(parts)
	# distance bar: full = 2 m or more; red inside the stop distance + 10 cm
	bar.visible = bool(s.get("tof", false))
	var f := 1.0 if d <= 0 else clampf(d / 2000.0, 0.03, 1.0)
	bar.scale = Vector3(f, 1, 1)
	bar.position.x = 1.05 - (1.0 - f) * 0.5
	var col := Color(0.2, 0.8, 0.45)
	if d > 0 and d < stop + 100:
		col = Color(0.95, 0.25, 0.25)
	elif d > 0 and d < stop + 400:
		col = Color(1.0, 0.75, 0.2)
	bar_mat.albedo_color = col

const WARN := {"bump": "BUMP - backed off", "step": "STEP / EDGE - backed off", "drop": "NO FLOOR - backed off", "blocked": "BLOCKED - something ahead", "blind": "SENSOR LINK LOST"}

func flash(kind: String) -> void:
	if _demo:
		return
	warn.text = WARN.get(kind, kind.to_upper())
	warn.modulate = Color(1, 0.75, 0.2) if kind == "blocked" else Color(1, 0.3, 0.3)
	warn.visible = true
	warn_until = Time.get_ticks_msec() + 2000

func _process(_dt: float) -> void:
	if warn.visible and Time.get_ticks_msec() > warn_until:
		warn.visible = false

# ------------------------------------------------------------------ mini-map
func set_map(m: Dictionary) -> void:
	_map = m
	if m.has("pose"):
		_pose = m["pose"]
	_bytes = Marshalls.base64_to_raw(str(m.get("cells", ""))) if m.has("cells") else PackedByteArray()
	_build_items(m)
	_rebuild_base()
	_draw_map()
	_draw_menu()

func set_state(st: Dictionary) -> void:
	if st.has("pose"):
		_pose = st["pose"]
		_draw_map()
	var t := str(st.get("news", ""))
	var busy = st.get("busy", null)
	news.text = ("Busy: %s\n" % str(busy) if busy != null else "") + t
	if st.has("targets"):
		_build_items({"targets": st["targets"]})
		_draw_menu()

func _cell_px(x: float, y: float) -> Vector2i:
	var res := float(_map.get("res", 0.05))
	var half := int(_map.get("half", 120))
	var i := int(floor(x / res)) + half - int(_map.get("i0", 0))
	var j := int(floor(y / res)) + half - int(_map.get("j0", 0))
	return Vector2i(i, int(_map.get("h", 1)) - 1 - j)   # ahead = up

func _dot(img: Image, p: Vector2i, r: int, col: Color) -> void:
	for dy in range(-r, r + 1):
		for dx in range(-r, r + 1):
			if dx * dx + dy * dy <= r * r:
				var q := p + Vector2i(dx, dy)
				if q.x >= 0 and q.y >= 0 and q.x < img.get_width() and q.y < img.get_height():
					img.set_pixelv(q, col)

func _rebuild_base() -> void:
	for c in map_labels.get_children():
		c.queue_free()
	_base = null
	if _bytes.is_empty():
		map_mat.albedo_texture = null
		map_mat.albedo_color = Color(0.1, 0.12, 0.15, 0.85)
		(map_quad.mesh as QuadMesh).size = Vector2(MAP_SIZE, MAP_SIZE * 0.6)
		if news.text == "":
			news.text = "The room map appears here when Muse Carpathron (PC) is linked and the car has explored. Click the left stick: missions."
		return
	var w := int(_map.get("w", 1))
	var h := int(_map.get("h", 1))
	var img := Image.create(w, h, false, Image.FORMAT_RGBA8)
	img.fill(Color(0.07, 0.09, 0.12, 0.85))
	for j in h:
		for i in w:
			var v := _bytes[j * w + i]
			if v > 127:
				v -= 256
			if v <= -8:
				var t := clampf(-v / 60.0, 0.0, 1.0)
				img.set_pixel(i, h - 1 - j, Color(0.42 + 0.38 * t, 0.5 + 0.33 * t, 0.56 + 0.3 * t))
			elif v >= 25:
				img.set_pixel(i, h - 1 - j, Color(1.0, 0.5, 0.15))
	for hz in _map.get("hazards", []):
		_dot(img, _cell_px(float(hz["x"]), float(hz["y"])), 3, Color(1, 0.15, 0.25))
	for o in _map.get("objects", []):
		_dot(img, _cell_px(float(o["x"]), float(o["y"])), 2, Color(0.65, 0.45, 1.0))
	for p in _map.get("places", []):
		_dot(img, _cell_px(float(p["x"]), float(p["y"])), 2, Color(0.2, 0.8, 0.45))
	var route = _map.get("route", null)
	if typeof(route) == TYPE_ARRAY:
		for pt in route:
			_dot(img, _cell_px(float(pt["x"]), float(pt["y"])), 1, Color(1, 0.85, 0.35))
	_base = img
	var sx := MAP_SIZE if w >= h else MAP_SIZE * w / h
	var sy := MAP_SIZE if h >= w else MAP_SIZE * h / w
	(map_quad.mesh as QuadMesh).size = Vector2(sx, sy)
	map_title.position.y = sy / 2 + 0.07
	news.position.y = -sy / 2 - 0.06
	# names of the objects and places (the first 12)
	var n := 0
	for o in _map.get("objects", []) + _map.get("places", []):
		if n >= 12:
			break
		n += 1
		var px := _cell_px(float(o["x"]), float(o["y"]))
		var l := Label3D.new()
		l.text = str(o["name"])
		l.pixel_size = 0.0019
		l.font_size = 34
		l.no_depth_test = true
		l.render_priority = 2
		l.outline_size = 12
		l.outline_modulate = Color(1, 1, 1, 0.95)
		l.modulate = Color(0.22, 0.08, 0.42)
		l.layers = 2
		l.position = Vector3((px.x / float(w) - 0.5) * sx, (0.5 - px.y / float(h)) * sy + 0.025, 0.005)
		map_labels.add_child(l)

## the room + the robot where it is now
func _draw_map() -> void:
	if _base == null:
		return
	var img := _base.duplicate()
	if not _pose.is_empty():
		var rp := _cell_px(float(_pose.get("x", 0)), float(_pose.get("y", 0)))
		var hd := deg_to_rad(float(_pose.get("heading", 0)))
		for k in range(1, 7):   # heading: a short yellow line
			_dot(img, rp + Vector2i(int(round(sin(hd) * k)), -int(round(cos(hd) * k))), 0, Color(1, 0.85, 0.3))
		_dot(img, rp, 2, Color(0.3, 0.55, 1.0))
	if _tex == null or _tex.get_size() != Vector2(img.get_width(), img.get_height()):
		_tex = ImageTexture.create_from_image(img)
	else:
		_tex.update(img)
	map_mat.albedo_texture = _tex
	map_mat.albedo_color = Color(1, 1, 1)

# ------------------------------------------------------------------ missions
func _build_items(m: Dictionary) -> void:
	var keep := ""
	if sel < items.size():
		keep = str(items[sel][1]) + str(items[sel][0])
	items = ITEMS_BASE.duplicate()
	var seen := {}
	var targets: Array = m.get("targets", [])
	if targets.is_empty():
		for o in m.get("places", []) + m.get("objects", []):
			targets.append({"name": o["name"]})
	for t in targets:
		var nm := str(t["name"])
		if seen.has(nm.to_lower()):
			continue
		seen[nm.to_lower()] = true
		items.append(["find", nm, "Find: " + nm])
	items.append(["stop", "", "Stop the mission"])
	sel = 0
	for i in items.size():
		if str(items[i][1]) + str(items[i][0]) == keep:
			sel = i

func toggle_menu() -> void:
	menu_open = not menu_open
	_draw_menu()

func move(d: int) -> void:
	if items.is_empty():
		return
	sel = (sel + d + items.size()) % items.size()
	_draw_menu()

func selected() -> Array:
	return items[sel] if sel < items.size() else ["stop", "", ""]

const HELP := "CONTROLS\nMenu (left): missions, robots,\n   training room, exit\nSticks: drive  ·  trigger: turbo\nA / X: STOP  ·  B: photo\nLeft stick click: missions\nRight grip: talk to Muse\nLeft grip: what do you see?"

func _draw_menu() -> void:
	if not menu_open:
		menu.text = HELP
		menu.modulate = Color(0.85, 0.88, 0.93)
		return
	menu.modulate = Color(0.95, 0.96, 0.98)
	var lines := ["MISSIONS", "left stick: choose · trigger: run · B: close · A/X: STOP", ""]
	var first := clampi(sel - 6, 0, maxi(0, items.size() - 13))
	for i in range(first, mini(items.size(), first + 13)):
		lines.append(("> " if i == sel else "   ") + str(items[i][2]))
	if items.size() > 13:
		lines.append("   (%d / %d)" % [sel + 1, items.size()])
	menu.text = "\n".join(lines)
