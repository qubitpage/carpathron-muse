extends Node3D
## Carpathron Avatar 1.5 — a text pill floating in the room: white text on a dark rounded pill, always facing you.
## Drawn as one solid picture (2D, rendered once per change) because outlined 3D text blends badly with Meta
## passthrough (it came out black over the real room).

var text := "" : set = set_text
var font_size := 30
var max_width := 760
var accent := Color(1.0, 0.56, 0.16)
var px := 0.0011                     # metres per pixel
var vp: SubViewport
var panel: PanelContainer
var label: Label
var dot: Label
var sprite: Sprite3D
var alpha := 1.0 : set = set_alpha

func _init(size := 30, width := 760, metres_per_px := 0.0011) -> void:
	font_size = size
	max_width = width
	px = metres_per_px

func _ready() -> void:
	vp = SubViewport.new()
	vp.transparent_bg = true
	vp.disable_3d = true
	vp.size = Vector2i(64, 32)
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	add_child(vp)
	panel = PanelContainer.new()
	var st := StyleBoxFlat.new()
	st.bg_color = Color(0.06, 0.07, 0.09, 1.0)
	st.set_corner_radius_all(int(font_size * 0.9))
	st.content_margin_left = font_size * 0.7; st.content_margin_right = font_size * 0.8
	st.content_margin_top = font_size * 0.3; st.content_margin_bottom = font_size * 0.38
	st.border_color = Color(1, 1, 1, 0.12)
	st.set_border_width_all(2)
	panel.add_theme_stylebox_override("panel", st)
	vp.add_child(panel)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", int(font_size * 0.35))
	panel.add_child(row)
	dot = Label.new()
	dot.text = "●"
	dot.add_theme_font_size_override("font_size", int(font_size * 0.6))
	dot.add_theme_color_override("font_color", accent)
	dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(dot)
	label = Label.new()
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", Color(0.97, 0.98, 1.0))
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	row.add_child(label)
	sprite = Sprite3D.new()
	sprite.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	sprite.alpha_cut = SpriteBase3D.ALPHA_CUT_DISCARD
	sprite.alpha_scissor_threshold = 0.5
	sprite.shaded = false
	sprite.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	sprite.pixel_size = px
	sprite.layers = 2
	sprite.texture = vp.get_texture()
	add_child(sprite)
	_apply()

func set_text(t: String) -> void:
	text = t
	if label:
		_apply()

func set_accent(c: Color) -> void:
	accent = c
	if dot:
		dot.add_theme_color_override("font_color", c)
		vp.render_target_update_mode = SubViewport.UPDATE_ONCE

func set_alpha(a: float) -> void:
	alpha = a
	if sprite:
		sprite.visible = a > 0.05 and text != ""

func _apply() -> void:
	label.text = text
	sprite.visible = text != "" and alpha > 0.05
	if text == "":
		return
	# measure: one line if it fits, otherwise wrap at max_width
	var f := label.get_theme_font("font")
	var w := f.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x
	label.custom_minimum_size = Vector2(minf(w + 2, max_width), 0)
	panel.reset_size()
	var sz := panel.get_combined_minimum_size()
	vp.size = Vector2i(int(ceil(sz.x)) + 2, int(ceil(sz.y)) + 2)
	panel.size = sz
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
