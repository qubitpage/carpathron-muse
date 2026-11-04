extends Node3D
## Carpathron Avatar 1.4 — the modern 3D panel used for the welcome screen and the menu.
## A real 2D interface (rounded cards, icons, hover / focus highlight, scrolling list) is drawn in a
## SubViewport and shown on a quad in front of you. Use it two ways:
##   - point with a controller (laser) and pull the trigger
##   - or push a stick up / down / left / right and pull the trigger
## B goes back, the Menu button closes it.

signal chosen(id: String, arg: String)

const PX := 1600
const PY := 1000
const M_PER_PX := 0.001          # the panel is 1.6 m x 1.0 m, 1.35 m in front of you

const C_BG := Color(0.055, 0.067, 0.09, 0.97)
const C_CARD := Color(0.11, 0.13, 0.17)
const C_CARD_HI := Color(0.16, 0.19, 0.25)
const C_ACCENT := Color(1.0, 0.56, 0.16)     # Carpathron orange
const C_BLUE := Color(0.33, 0.56, 1.0)
const C_GREEN := Color(0.27, 0.8, 0.5)
const C_RED := Color(0.95, 0.32, 0.32)
const C_TEXT := Color(0.95, 0.96, 0.98)
const C_SUB := Color(0.6, 0.65, 0.73)

var vp: SubViewport
var quad: MeshInstance3D
var root: Control
var is_open := false
var page := "main"
var provider: Callable          # func(page) -> {title, subtitle, layout, items, robots, chips, hint}
var _last_px := Vector2(-1, -1)
var _first: Control = null
var _focus_key := ""
var _pending := false
var fields := {}                # 1.6: text typed into fields (e.g. the Meta API key), by field name

func _ready() -> void:
	vp = SubViewport.new()
	vp.size = Vector2i(PX, PY)
	vp.transparent_bg = true
	vp.disable_3d = true
	vp.gui_embed_subwindows = true
	vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(vp)
	root = Control.new()
	root.size = Vector2(PX, PY)
	vp.add_child(root)
	quad = MeshInstance3D.new()
	var q := QuadMesh.new(); q.size = Vector2(PX * M_PER_PX, PY * M_PER_PX)
	quad.mesh = q
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_texture = vp.get_texture()
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR
	m.no_depth_test = true
	m.render_priority = 5
	quad.material_override = m
	quad.layers = 2
	add_child(quad)
	visible = false

# ------------------------------------------------------------------ open / close / pages
## in front of where you look, 1.35 m away, a little below eye height, turned to you
func open_at(cam: Node3D, p := "main") -> void:
	var t := cam.global_transform
	var fwd := -t.basis.z
	fwd.y = 0
	if fwd.length() < 0.01:
		fwd = Vector3(0, 0, -1)
	fwd = fwd.normalized()
	global_position = t.origin + fwd * 1.35 + Vector3(0, -0.12, 0)
	look_at(global_position + fwd, Vector3.UP)
	is_open = true
	visible = true
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	show_page(p)

func close() -> void:
	is_open = false
	visible = false
	vp.render_target_update_mode = SubViewport.UPDATE_DISABLED

func show_page(p: String) -> void:
	page = p
	_focus_key = ""
	refresh()

func back() -> void:
	var d: Dictionary = provider.call(page) if provider.is_valid() else {}
	var parent := str(d.get("parent", "main"))
	if page == "welcome":
		return
	if page != "main":
		show_page(parent)
	else:
		close()

## rebuild the page (keeps the focused row); called when robots are found, Muse links, a setting changes...
func refresh() -> void:
	if not is_open or _pending:
		return
	if vp.gui_get_focus_owner() is LineEdit:
		return   # never rebuild under your fingers while you type
	_pending = true
	_rebuild.call_deferred()

func _rebuild() -> void:
	_pending = false
	if not is_open or not provider.is_valid():
		return
	var fo := vp.gui_get_focus_owner()
	if fo and fo.has_meta("key"):
		_focus_key = str(fo.get_meta("key"))
	for c in root.get_children():
		root.remove_child(c)
		c.queue_free()
	_first = null
	var d: Dictionary = provider.call(page)
	var bg := Panel.new()
	bg.size = Vector2(PX, PY)
	bg.add_theme_stylebox_override("panel", _box(C_BG, 40, 2, Color(1, 1, 1, 0.07)))
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(bg)
	_header(d)
	if str(d.get("layout", "list")) == "welcome":
		_welcome(d)
	else:
		_list(d.get("items", []), Rect2(56, 196, PX - 112, PY - 196 - 92))
	var hint := _label(str(d.get("hint", "Point and pull the trigger   ·   or stick + trigger   ·   B back   ·   Menu close   ·   A / X STOP")), 27, C_SUB)
	hint.position = Vector2(56, PY - 70)
	hint.size = Vector2(PX - 112, 40)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(hint)
	# focus: the same row as before, or the first one
	var target: Control = _first
	if _focus_key != "":
		var f := _find_key(root, _focus_key)
		if f:
			target = f
	if target:
		target.grab_focus()

func _find_key(n: Node, k: String) -> Control:
	for c in n.get_children():
		if c is Control and c.has_meta("key") and str(c.get_meta("key")) == k:
			return c
		var r := _find_key(c, k)
		if r:
			return r
	return null

# ------------------------------------------------------------------ building blocks
func _box(col: Color, radius: int, border := 0, bcol := Color.TRANSPARENT) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = col
	s.set_corner_radius_all(radius)
	s.set_border_width_all(border)
	s.border_color = bcol
	s.anti_aliasing = true
	s.corner_detail = 12
	return s

func _label(t: String, size: int, col: Color) -> Label:
	var l := Label.new()
	l.text = t
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", col)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l

## a round icon: coloured circle with a symbol in it
func _icon(sym: String, col: Color, d: int) -> Panel:
	var p := Panel.new()
	p.custom_minimum_size = Vector2(d, d)
	p.size = Vector2(d, d)
	p.add_theme_stylebox_override("panel", _box(Color(col.r, col.g, col.b, 0.18), d / 2, 2, Color(col.r, col.g, col.b, 0.55)))
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var l := _label(sym, int(d * 0.46), col)
	l.size = Vector2(d, d)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	p.add_child(l)
	return p

func _chip(t: String, col: Color) -> PanelContainer:
	var c := PanelContainer.new()
	var s := _box(Color(col.r, col.g, col.b, 0.14), 22, 2, Color(col.r, col.g, col.b, 0.5))
	s.content_margin_left = 18; s.content_margin_right = 18; s.content_margin_top = 6; s.content_margin_bottom = 6
	c.add_theme_stylebox_override("panel", s)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	c.add_child(_label(t, 26, col))
	return c

## a big clickable card / row: a Button with hover + focus highlight; labels inside ignore the mouse
func _button(key: String, id: String, arg: String, h: int, accent := C_ACCENT) -> Button:
	var b := Button.new()
	b.set_meta("key", key)
	b.custom_minimum_size = Vector2(0, h)
	b.focus_mode = Control.FOCUS_ALL
	b.add_theme_stylebox_override("normal", _box(C_CARD, 24, 2, Color(1, 1, 1, 0.05)))
	b.add_theme_stylebox_override("hover", _box(C_CARD_HI, 24, 3, Color(accent.r, accent.g, accent.b, 0.6)))
	b.add_theme_stylebox_override("focus", _box(Color(0, 0, 0, 0), 24, 4, accent))
	b.add_theme_stylebox_override("pressed", _box(Color(accent.r, accent.g, accent.b, 0.35), 24, 4, accent))
	b.mouse_entered.connect(func(): b.grab_focus())
	b.focus_entered.connect(func(): b.add_theme_stylebox_override("normal", _box(C_CARD_HI, 24, 2, Color(1, 1, 1, 0.05))))
	b.focus_exited.connect(func(): b.add_theme_stylebox_override("normal", _box(C_CARD, 24, 2, Color(1, 1, 1, 0.05))))
	b.pressed.connect(func(): chosen.emit(id, arg))
	if _first == null:
		_first = b
	return b

func _header(d: Dictionary) -> void:
	var logo := _icon("C", C_ACCENT, 88)
	logo.position = Vector2(56, 52)
	root.add_child(logo)
	var t := _label(str(d.get("title", "")), 50, C_TEXT)
	t.position = Vector2(166, 44)
	root.add_child(t)
	var st := _label(str(d.get("subtitle", "")), 28, C_SUB)
	st.position = Vector2(168, 108)
	root.add_child(st)
	var chips := HBoxContainer.new()
	chips.add_theme_constant_override("separation", 12)
	chips.alignment = BoxContainer.ALIGNMENT_END
	chips.position = Vector2(PX - 56 - 700, 66)
	chips.size = Vector2(700, 50)
	chips.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for c in d.get("chips", []):
		chips.add_child(_chip(str(c[0]), c[1]))
	root.add_child(chips)
	var line := ColorRect.new()
	line.color = Color(1, 1, 1, 0.06)
	line.position = Vector2(56, 172)
	line.size = Vector2(PX - 112, 2)
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(line)

## rows: {id, arg, icon, color, label, sub, value}
func _row(it: Dictionary) -> Button:
	var col: Color = it.get("color", C_ACCENT)
	var b := _button(str(it["id"]) + "|" + str(it.get("arg", "")), str(it["id"]), str(it.get("arg", "")), 96, col)
	var ic := _icon(str(it.get("icon", "•")), col, 60)
	ic.position = Vector2(22, 18)
	b.add_child(ic)
	var l := _label(str(it.get("label", "")), 36, C_TEXT)
	l.position = Vector2(104, 12 if it.get("sub", "") != "" else 26)
	b.add_child(l)
	if str(it.get("sub", "")) != "":
		var s := _label(str(it["sub"]), 25, C_SUB)
		s.position = Vector2(106, 54)
		b.add_child(s)
	if str(it.get("value", "")) != "":
		var v := _chip(str(it["value"]), col)
		v.position = Vector2(PX - 112 - 40 - 330, 26)
		v.size = Vector2(330, 44)
		var holder := HBoxContainer.new()
		holder.alignment = BoxContainer.ALIGNMENT_END
		holder.position = Vector2(PX - 112 - 30 - 420, 24)
		holder.size = Vector2(420, 48)
		holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
		holder.add_child(v)
		b.add_child(holder)
	return b

## a text field: point + trigger opens the Quest keyboard; the text is kept in fields[name]
func _field(it: Dictionary) -> Control:
	var name := str(it["field"])
	var box := Panel.new()
	box.custom_minimum_size = Vector2(0, 112)
	box.add_theme_stylebox_override("panel", _box(C_CARD, 24, 2, Color(1, 1, 1, 0.05)))
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var l := _label(str(it.get("label", "")), 27, C_SUB)
	l.position = Vector2(28, 10)
	box.add_child(l)
	var le := LineEdit.new()
	le.set_meta("key", "field|" + name)
	le.position = Vector2(24, 46)
	le.size = Vector2(PX - 112 - 48, 56)
	le.add_theme_font_size_override("font_size", 30)
	le.placeholder_text = str(it.get("placeholder", "Point here and pull the trigger to type"))
	le.secret = bool(it.get("secret", false))
	le.text = str(fields.get(name, it.get("value", "")))
	le.virtual_keyboard_enabled = true
	le.virtual_keyboard_type = LineEdit.KEYBOARD_TYPE_PASSWORD if le.secret else LineEdit.KEYBOARD_TYPE_DEFAULT
	le.add_theme_stylebox_override("normal", _box(Color(0.05, 0.06, 0.08), 16, 2, Color(1, 1, 1, 0.08)))
	le.add_theme_stylebox_override("focus", _box(Color(0.05, 0.06, 0.08), 16, 3, C_ACCENT))
	le.text_changed.connect(func(t): fields[name] = t)
	le.text_submitted.connect(func(t):
		fields[name] = t
		chosen.emit("field", name))
	le.mouse_entered.connect(func(): le.grab_focus())
	box.add_child(le)
	if _first == null:
		_first = le
	return box

## the Quest keyboard types into the main window: pass the keys on to the menu (where the text field is)
func _input(event: InputEvent) -> void:
	if is_open and event is InputEventKey and vp.gui_get_focus_owner() is LineEdit:
		vp.push_input(event)
		get_viewport().set_input_as_handled()

func _list(items: Array, area: Rect2) -> void:
	var sc := ScrollContainer.new()
	sc.position = area.position
	sc.size = area.size
	sc.follow_focus = true
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	sc.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	root.add_child(sc)
	var vb := VBoxContainer.new()
	vb.custom_minimum_size = Vector2(area.size.x, 0)
	vb.add_theme_constant_override("separation", 14)
	sc.add_child(vb)
	for it in items:
		if it.has("section"):
			var s := _label(str(it["section"]).to_upper(), 22, C_SUB)
			s.custom_minimum_size = Vector2(0, 34)
			vb.add_child(s)
			continue
		if it.has("field"):
			vb.add_child(_field(it))
			continue
		vb.add_child(_row(it))

## the welcome screen: the virtual tour card on the left, your robots on the right
func _welcome(d: Dictionary) -> void:
	var top := 204
	var h := PY - top - 104
	# left: two cards — 1.5: "Carpathron in my room" (mixed reality companion) on top, the virtual tour below
	var ch := (h - 22) / 2
	var room := _card("room", Vector2(56, top), Vector2(600, ch), "◉", C_ACCENT, "Carpathron in my room",
		str(d.get("room_text", "")), "Meet him   ▶")
	var tour := _card("tour", Vector2(56, top + ch + 22), Vector2(600, ch), "▶", C_BLUE, "Virtual tour",
		str(d.get("tour_text", "")), "Start the tour   ▶")
	# right: your robots
	var card := Panel.new()
	card.position = Vector2(684, top)
	card.size = Vector2(PX - 684 - 56, h)
	card.add_theme_stylebox_override("panel", _box(Color(0.09, 0.105, 0.14), 24, 2, Color(1, 1, 1, 0.05)))
	card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(card)
	var rt := _label("Your robots", 40, C_TEXT)
	rt.position = Vector2(34, 26)
	card.add_child(rt)
	var rs := _label(str(d.get("robots_text", "")), 27, C_SUB)
	rs.position = Vector2(36, 82)
	card.add_child(rs)
	var vb := VBoxContainer.new()
	vb.position = Vector2(28, 132)
	vb.size = Vector2(card.size.x - 56, h - 150)
	vb.add_theme_constant_override("separation", 12)
	card.add_child(vb)
	for it in d.get("robots", []):
		var b := _robot_row(it, card.size.x - 56)
		vb.add_child(b)
	var again := _button("search|", "search", "", 70, C_SUB)
	var al := _label("⟳   Search again on this Wi-Fi", 28, C_SUB)
	al.position = Vector2(24, 18)
	again.add_child(al)
	vb.add_child(again)
	if _first == room and not d.get("robots", []).is_empty() and bool(d.get("robot_first", false)):
		_first = vb.get_child(0)

## a big card button on the welcome screen: icon, title, two lines, call to action
func _card(id: String, pos: Vector2, sz: Vector2, icon: String, col: Color, title: String, text: String, cta_text: String) -> Button:
	var c := _button(id, id, "", sz.y, col)
	c.position = pos
	c.size = sz
	root.add_child(c)
	var ic := _icon(icon, col, 84)
	ic.position = Vector2(32, 30)
	c.add_child(ic)
	var t1 := _label(title, 40, C_TEXT)
	t1.position = Vector2(140, 34)
	c.add_child(t1)
	var t2 := _label(text, 26, C_SUB)
	t2.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	t2.position = Vector2(140, 90)
	t2.size = Vector2(sz.x - 170, sz.y - 170)
	c.add_child(t2)
	var cta := _chip(cta_text, col)
	cta.position = Vector2(140, sz.y - 78)
	c.add_child(cta)
	return c

func _robot_row(it: Dictionary, w: float) -> Button:
	var col: Color = it.get("color", C_GREEN)
	var b := _button("robot|" + str(it.get("arg", "")), str(it.get("id", "robot")), str(it.get("arg", "")), 104, col)
	var dot := Panel.new()
	dot.size = Vector2(22, 22)
	dot.position = Vector2(26, 41)
	dot.add_theme_stylebox_override("panel", _box(col, 11))
	dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(dot)
	var l := _label(str(it.get("label", "")), 36, C_TEXT)
	l.position = Vector2(70, 14)
	b.add_child(l)
	var s := _label(str(it.get("sub", "")), 25, C_SUB)
	s.position = Vector2(72, 58)
	b.add_child(s)
	var v := _chip(str(it.get("value", "Connect")), col)
	var holder := HBoxContainer.new()
	holder.alignment = BoxContainer.ALIGNMENT_END
	holder.position = Vector2(w - 300 - 24, 28)
	holder.size = Vector2(300, 48)
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(v)
	b.add_child(holder)
	return b

# ------------------------------------------------------------------ input
## laser: returns the hit point (global) when the ray meets the panel, else null; moves the 2D pointer
func pointer(from: Vector3, dir: Vector3) -> Variant:
	if not is_open:
		return null
	var t := quad.global_transform
	var n := t.basis.z.normalized()
	var den := n.dot(dir)
	if absf(den) < 0.0001:
		return null
	var dist := n.dot(t.origin - from) / den
	if dist <= 0.0:
		return null
	var hit := from + dir * dist
	var loc := t.affine_inverse() * hit
	var w := PX * M_PER_PX
	var h := PY * M_PER_PX
	if absf(loc.x) > w / 2 or absf(loc.y) > h / 2:
		return null
	var px := Vector2((loc.x / w + 0.5) * PX, (0.5 - loc.y / h) * PY)
	if px.distance_to(_last_px) > 0.5:
		_last_px = px
		var ev := InputEventMouseMotion.new()
		ev.position = px
		ev.global_position = px
		vp.push_input(ev)
	return hit

func click(down: bool) -> void:
	var ev := InputEventMouseButton.new()
	ev.button_index = MOUSE_BUTTON_LEFT
	ev.pressed = down
	ev.position = _last_px
	ev.global_position = _last_px
	vp.push_input(ev)

## stick / keys: "ui_up", "ui_down", "ui_left", "ui_right", "ui_accept"
func nav(action: String) -> void:
	for down in [true, false]:
		var ev := InputEventAction.new()
		ev.action = action
		ev.pressed = down
		vp.push_input(ev)
