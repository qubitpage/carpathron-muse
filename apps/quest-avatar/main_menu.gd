extends Node3D
## Carpathron Avatar 1.3 — one menu in front of you (Menu button on the LEFT controller):
##   missions · choose robot (list) · training room (3D demo) · bring the screen in front of me ·
##   head steering · driving mode · close · EXIT
## Either stick up/down = choose, trigger = select, B / Y = back, Menu = close. A / X always STOP the robot.

signal chosen(action: String, arg: String)

const W := 2.0
const H := 1.45

var is_open := false
var page := "main"
var sel := 0
var items: Array = []      # [action, arg, text]
var provider: Callable     # func(page: String) -> {"title": String, "items": Array}
var bg: MeshInstance3D
var title: Label3D
var body: Label3D
var hint: Label3D

func _ready() -> void:
	bg = MeshInstance3D.new()
	var q := QuadMesh.new(); q.size = Vector2(W, H)
	bg.mesh = q
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = Color(0.05, 0.07, 0.1, 0.93)
	m.no_depth_test = true
	m.render_priority = 5
	bg.material_override = m
	bg.layers = 2
	add_child(bg)
	title = _lbl(Vector3(0, H / 2 - 0.1, 0.01), 0.0019, 52, Color(1.0, 0.7, 0.28))
	body = _lbl(Vector3(-W / 2 + 0.1, H / 2 - 0.22, 0.01), 0.0015, 46, Color(0.93, 0.95, 0.98))
	body.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	body.vertical_alignment = VERTICAL_ALIGNMENT_TOP
	body.width = (W - 0.2) / 0.0015
	body.autowrap_mode = TextServer.AUTOWRAP_OFF
	hint = _lbl(Vector3(0, -H / 2 + 0.07, 0.01), 0.0013, 40, Color(0.65, 0.7, 0.78))
	hint.text = "stick up / down: choose   ·   trigger: select   ·   B: back   ·   Menu: close   ·   A / X: STOP"
	visible = false

func _lbl(pos: Vector3, px: float, size: int, col: Color) -> Label3D:
	var l := Label3D.new()
	l.position = pos
	l.pixel_size = px
	l.font_size = size
	l.modulate = col
	l.outline_size = 8
	l.outline_modulate = Color(0.03, 0.04, 0.06, 0.95)
	l.no_depth_test = true
	l.render_priority = 6
	l.layers = 2
	add_child(l)
	return l

## open in front of the camera (where you look now), 1.3 m away, at eye height
func open_at(cam: Node3D, p := "main") -> void:
	var t := cam.global_transform
	var fwd := -t.basis.z
	fwd.y = 0
	if fwd.length() < 0.01:
		fwd = Vector3(0, 0, -1)
	fwd = fwd.normalized()
	global_position = t.origin + fwd * 1.3 + Vector3(0, -0.12, 0)
	look_at(global_position + fwd, Vector3.UP)   # -Z faces away from you, so the front faces you
	is_open = true
	visible = true
	show_page(p)

func close() -> void:
	is_open = false
	visible = false

func show_page(p: String) -> void:
	page = p
	sel = 0
	refresh()

func refresh() -> void:
	if not is_open or not provider.is_valid():
		return
	var keep := ""
	if sel < items.size():
		keep = str(items[sel][0]) + "|" + str(items[sel][1])
	var d: Dictionary = provider.call(page)
	items = d.get("items", [])
	title.text = str(d.get("title", ""))
	sel = clampi(sel, 0, maxi(0, items.size() - 1))
	for i in items.size():
		if str(items[i][0]) + "|" + str(items[i][1]) == keep:
			sel = i
	_draw()

func _draw() -> void:
	var lines: Array = []
	var first := clampi(sel - 4, 0, maxi(0, items.size() - 10))
	if first > 0:
		lines.append("      ▲")
	for i in range(first, mini(items.size(), first + 10)):
		lines.append(("▶  " if i == sel else "     ") + str(items[i][2]))
	if first + 10 < items.size():
		lines.append("      ▼")
	body.text = "\n".join(lines)

func move(d: int) -> void:
	if items.is_empty():
		return
	sel = (sel + d + items.size()) % items.size()
	_draw()

func activate() -> void:
	if sel < items.size():
		chosen.emit(str(items[sel][0]), str(items[sel][1]))

func back() -> void:
	if page != "main":
		show_page("main")
	else:
		close()
