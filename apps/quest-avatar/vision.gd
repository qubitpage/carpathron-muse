extends Node3D
## Carpathron Avatar 1.4 — smart vision on the robot's picture: Muse Carpathron (PC) names people, animals,
## obstacles, furniture, doors and items in the newest camera picture every few seconds; here each one gets a
## coloured box and a label on the picture (VR view or flat screen). Close ones are filled and say "close".

const COLORS := {"human": Color(1.0, 0.6, 0.15), "animal": Color(0.3, 0.85, 0.45), "obstacle": Color(0.95, 0.3, 0.3),
	"furniture": Color(0.6, 0.65, 1.0), "door": Color(0.85, 0.75, 0.4), "item": Color(0.35, 0.75, 1.0)}
const W := 320
const H := 240

var tex: ImageTexture
var img: Image
var labels: Node3D
var _last_at := -1

func _ready() -> void:
	img = Image.create(W, H, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	tex = ImageTexture.create_from_image(img)
	labels = Node3D.new()
	add_child(labels)

func _rect(x0: int, y0: int, x1: int, y1: int, c: Color) -> void:
	for x in range(clampi(x0, 0, W - 1), clampi(x1, 0, W - 1) + 1):
		for y in range(clampi(y0, 0, H - 1), clampi(y1, 0, H - 1) + 1):
			img.set_pixel(x, y, c)

## seen: [{label, kind, box:[x,y,w,h] (0..1), near}]; place(u, v) -> Vector3 where a picture point is in 3D
func show_seen(seen: Array, at: int, place: Callable, parent: Node3D) -> void:
	if at == _last_at and labels.get_parent() == parent:
		return
	_last_at = at
	if labels.get_parent() != parent:
		labels.get_parent().remove_child(labels)
		parent.add_child(labels)
	for c in labels.get_children():
		c.queue_free()
	img.fill(Color(0, 0, 0, 0))
	for o in seen:
		var b: Array = o.get("box", [0, 0, 0, 0])
		var col: Color = COLORS.get(str(o.get("kind", "item")), COLORS["item"])
		var near := bool(o.get("near", false))
		var x0 := int(float(b[0]) * W); var y0 := int(float(b[1]) * H)
		var x1 := int((float(b[0]) + float(b[2])) * W); var y1 := int((float(b[1]) + float(b[3])) * H)
		if near:
			_rect(x0, y0, x1, y1, Color(col.r, col.g, col.b, 0.16))
		var t := 2
		_rect(x0, y0, x1, y0 + t, col); _rect(x0, y1 - t, x1, y1, col)
		_rect(x0, y0, x0 + t, y1, col); _rect(x1 - t, y0, x1, y1, col)
		var l := Label3D.new()
		l.text = str(o.get("label", "")) + ("  ·  close" if near else "")
		l.font_size = 48
		l.pixel_size = 0.0019
		l.outline_size = 12
		l.outline_modulate = Color(0.03, 0.04, 0.06, 0.95)
		l.modulate = col
		l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		l.no_depth_test = true
		l.render_priority = 4
		l.layers = 2
		l.position = place.call(float(b[0]) + float(b[2]) / 2.0, maxf(0.03, float(b[1]) - 0.035))
		labels.add_child(l)
	tex.update(img)

func clear() -> void:
	if _last_at == -2:
		return
	_last_at = -2
	for c in labels.get_children():
		c.queue_free()
	img.fill(Color(0, 0, 0, 0))
	tex.update(img)
