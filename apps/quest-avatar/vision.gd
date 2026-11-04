extends Node
## Carpathron Avatar 1.5 — smart vision on the robot's picture. Muse Carpathron (PC) names people, animals,
## obstacles, furniture, doors and items in the newest camera picture every few seconds, and SAM 3.1 cuts each one
## out: here every object gets its real outline (a thin glowing contour with a light tint inside) and a small
## rounded name tag — no heavy boxes. Drawn as 2D vector shapes into a transparent picture laid over the camera
## picture (VR view or flat screen). Without an outline (SAM busy) only four slim corner marks show.

const COLORS := {"human": Color(1.0, 0.66, 0.3), "animal": Color(0.36, 0.9, 0.58), "obstacle": Color(1.0, 0.42, 0.42),
	"furniture": Color(0.55, 0.68, 1.0), "door": Color(0.95, 0.82, 0.45), "item": Color(0.42, 0.85, 1.0)}
const ICONS := {"human": "●", "animal": "●", "obstacle": "▲", "furniture": "●", "door": "●", "item": "●"}
const W := 1024
const H := 768

var vp: SubViewport
var root: Control
var tex: Texture2D
var _last_at := -1
var _style: StyleBoxFlat

func _ready() -> void:
	vp = SubViewport.new()
	vp.size = Vector2i(W, H)
	vp.transparent_bg = true
	vp.disable_3d = true
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	add_child(vp)
	root = Control.new()
	root.size = Vector2(W, H)
	vp.add_child(root)
	tex = vp.get_texture()
	_style = StyleBoxFlat.new()
	_style.bg_color = Color(0.05, 0.06, 0.08, 0.74)
	_style.set_corner_radius_all(16)
	_style.content_margin_left = 12; _style.content_margin_right = 14
	_style.content_margin_top = 4; _style.content_margin_bottom = 5
	_style.anti_aliasing = true

static func _closed(pts: PackedVector2Array) -> PackedVector2Array:
	var c := pts.duplicate()
	if c.size() > 0:
		c.append(c[0])
	return c

## seen: [{label, kind, box:[x,y,w,h] (0..1), poly:[x0,y0,x1,y1...] (0..1), near, dist}]
func show_seen(seen: Array, at: int) -> void:
	if at == _last_at:
		return
	_last_at = at
	for c in root.get_children():
		root.remove_child(c)
		c.queue_free()
	var tags: Array = []   # placed tag rectangles, so tags do not cover each other
	for o in seen:
		var kind := str(o.get("kind", "item"))
		var col: Color = COLORS.get(kind, COLORS["item"])
		var near := bool(o.get("near", false))
		var b: Array = o.get("box", [0, 0, 0, 0])
		var bx := Rect2(float(b[0]) * W, float(b[1]) * H, float(b[2]) * W, float(b[3]) * H)
		var poly: Array = o.get("poly", [])
		var pts := PackedVector2Array()
		for i in range(0, poly.size() - 1, 2):
			pts.append(Vector2(float(poly[i]) * W, float(poly[i + 1]) * H))
		var top := Vector2(bx.get_center().x, bx.position.y)
		if pts.size() >= 3:
			# light tint inside, a soft glow and a crisp thin outline
			var fill := Polygon2D.new()
			fill.polygon = pts
			fill.color = Color(col.r, col.g, col.b, 0.2 if near else 0.11)
			fill.antialiased = true
			root.add_child(fill)
			for layer in [[9.0, 0.16], [2.6, 0.95]]:
				var ln := Line2D.new()
				ln.points = _closed(pts)
				ln.width = layer[0]
				ln.default_color = Color(col.r, col.g, col.b, layer[1])
				ln.joint_mode = Line2D.LINE_JOINT_ROUND
				ln.begin_cap_mode = Line2D.LINE_CAP_ROUND
				ln.antialiased = true
				root.add_child(ln)
			var miny := INF
			for p in pts:
				if p.y < miny:
					miny = p.y; top = p
		else:
			# no outline yet: four slim corner marks
			var k := minf(bx.size.x, bx.size.y) * 0.18
			var c := [bx.position, Vector2(bx.end.x, bx.position.y), bx.end, Vector2(bx.position.x, bx.end.y)]
			var dirs := [Vector2(1, 1), Vector2(-1, 1), Vector2(-1, -1), Vector2(1, -1)]
			for i in 4:
				var ln := Line2D.new()
				ln.points = PackedVector2Array([c[i] + Vector2(dirs[i].x * k, 0), c[i], c[i] + Vector2(0, dirs[i].y * k)])
				ln.width = 2.6
				ln.default_color = Color(col.r, col.g, col.b, 0.9)
				ln.joint_mode = Line2D.LINE_JOINT_ROUND
				ln.antialiased = true
				root.add_child(ln)
		_tag(o, col, near, top, tags)
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE

## the name tag: a small rounded dark pill with a coloured dot, the name and the distance
func _tag(o: Dictionary, col: Color, near: bool, anchor: Vector2, tags: Array) -> void:
	var pill := PanelContainer.new()
	var st := _style.duplicate() as StyleBoxFlat
	if near:
		st.border_color = col
		st.set_border_width_all(2)
	pill.add_theme_stylebox_override("panel", st)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 7)
	pill.add_child(row)
	var dot := Label.new()
	dot.text = ICONS.get(str(o.get("kind", "item")), "●")
	dot.add_theme_color_override("font_color", col)
	dot.add_theme_font_size_override("font_size", 16)
	row.add_child(dot)
	var name := Label.new()
	name.text = str(o.get("label", "")).capitalize()
	name.add_theme_color_override("font_color", Color(0.97, 0.98, 1.0))
	name.add_theme_font_size_override("font_size", 23)
	row.add_child(name)
	var extra := ""
	if o.has("dist"):
		extra = "%.1f m" % float(o["dist"])
	if near:
		extra = "close" if extra == "" else extra + " · close"
	if extra != "":
		var d := Label.new()
		d.text = extra
		d.add_theme_color_override("font_color", Color(0.72, 0.76, 0.82) if not near else col)
		d.add_theme_font_size_override("font_size", 18)
		row.add_child(d)
	root.add_child(pill)
	var sz := pill.get_combined_minimum_size()
	var pos := Vector2(anchor.x - sz.x / 2.0, anchor.y - sz.y - 10.0)
	pos.x = clampf(pos.x, 6.0, W - sz.x - 6.0)
	pos.y = clampf(pos.y, 6.0, H - sz.y - 6.0)
	# move down (inside the object) when another tag is already there
	for _i in 6:
		var r := Rect2(pos, sz)
		var hit := false
		for t in tags:
			if (t as Rect2).grow(4).intersects(r):
				hit = true; break
		if not hit:
			break
		pos.y = clampf(pos.y + sz.y + 6.0, 6.0, H - sz.y - 6.0)
	pill.position = pos
	tags.append(Rect2(pos, sz))

func clear() -> void:
	if _last_at == -2:
		return
	_last_at = -2
	for c in root.get_children():
		root.remove_child(c)
		c.queue_free()
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
