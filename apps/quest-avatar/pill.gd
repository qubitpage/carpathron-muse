extends Node3D
## Carpathron Avatar 1.5 — a text pill floating in the room: white text on a dark rounded plate, turned to you.
## Both are drawn solid (no see-through blending): see-through 3D text came out black over Meta passthrough, and
## text drawn into an off-screen picture could flash up as a black rectangle before it was ready.

var text := "" : set = set_text
var font_size := 30
var max_width := 760
var accent := Color(1.0, 0.56, 0.16)
var px := 0.0011                     # metres per pixel
var alpha := 1.0 : set = set_alpha
var label: Label3D
var plate: MeshInstance3D
var dot: MeshInstance3D
var _mat: ShaderMaterial
var _dot_mat: StandardMaterial3D

const PLATE := """
shader_type spatial;
render_mode unshaded, cull_disabled;
uniform vec2 size = vec2(1.0, 0.2);
uniform float radius = 0.05;
uniform vec4 color : source_color = vec4(0.06, 0.07, 0.09, 1.0);
uniform vec4 edge : source_color = vec4(0.25, 0.27, 0.32, 1.0);
void fragment() {
	vec2 p = (UV - 0.5) * size;
	vec2 q = abs(p) - (size * 0.5 - vec2(radius));
	float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
	if (d > 0.0) discard;
	ALBEDO = d > -0.0025 ? edge.rgb : color.rgb;
}
"""

func _init(size := 30, width := 760, metres_per_px := 0.0011) -> void:
	font_size = size
	max_width = width
	px = metres_per_px

func _ready() -> void:
	plate = MeshInstance3D.new()
	plate.mesh = QuadMesh.new()
	_mat = ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = PLATE
	_mat.shader = sh
	plate.material_override = _mat
	plate.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	plate.layers = 2
	add_child(plate)
	label = Label3D.new()
	label.font_size = font_size
	label.pixel_size = px
	label.outline_size = 0
	label.modulate = Color(0.97, 0.98, 1.0)
	label.alpha_cut = Label3D.ALPHA_CUT_DISCARD
	label.alpha_scissor_threshold = 0.45
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.position.z = 0.003
	label.layers = 2
	add_child(label)
	dot = MeshInstance3D.new()
	var sm := SphereMesh.new(); sm.radius = 0.5; sm.height = 1.0; sm.radial_segments = 12; sm.rings = 6
	dot.mesh = sm
	_dot_mat = StandardMaterial3D.new()
	_dot_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_dot_mat.albedo_color = accent
	dot.material_override = _dot_mat
	dot.layers = 2
	add_child(dot)
	_apply()

func set_text(t: String) -> void:
	text = t
	if label:
		_apply()

func set_accent(c: Color) -> void:
	accent = c
	if _dot_mat:
		_dot_mat.albedo_color = c

func set_alpha(a: float) -> void:
	alpha = a
	if label:
		visible = a > 0.05 and text != ""

func _apply() -> void:
	label.text = text
	visible = text != "" and alpha > 0.05
	if text == "":
		return
	var f: Font = ThemeDB.fallback_font
	var one := f.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size)
	var w := minf(one.x + 4.0, float(max_width))
	label.width = w
	var sz := f.get_multiline_string_size(text, HORIZONTAL_ALIGNMENT_CENTER, w, font_size)
	var pad := Vector2(font_size * 1.6, font_size * 0.7)
	var size_m := (Vector2(maxf(w, sz.x), sz.y) + pad) * px
	(plate.mesh as QuadMesh).size = size_m
	_mat.set_shader_parameter("size", size_m)
	_mat.set_shader_parameter("radius", minf(size_m.y * 0.5, font_size * 0.8 * px))
	var dr := font_size * 0.17 * px
	dot.scale = Vector3.ONE * dr * 2.0
	dot.position = Vector3(-size_m.x * 0.5 + font_size * 0.55 * px, 0, 0.004)
	label.position.x = font_size * 0.25 * px

## always turned to the person (like a billboard, but plate and text stay together)
func _process(_dt: float) -> void:
	if not visible:
		return
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return
	var to := cam.global_position - global_position
	if to.length() > 0.01:
		look_at(global_position - to, Vector3.UP)
