extends Node
## Carpathron Avatar 1.4 — "Quest view" for Muse Carpathron on the PC.
## A second, ordinary camera follows your head (smoothed, so the picture is calm) and renders what you see —
## the robot's picture, the menus, your controllers, the virtual tour — about 10 times a second, 854 x 480.
## Each picture goes to Muse Carpathron (/avatar/view), which shows it live in Robots > Live, so the PC screen
## can be recorded and everyone sees what happens inside the headset. Only while the headset is linked to Muse.

const FPS := 10.0
var vp: SubViewport
var eye: Camera3D
var src: Node3D            # the headset camera
var muse: Node
var mode_fn: Callable      # -> "tour" / "robot" / ""
var enabled := true
var _next := 0
var _pending := false
var _xf := Transform3D()
var _has := false
var bg_fn: Callable         # 1.5 mixed reality: -> the headset camera picture (Texture2D) behind the 3D, or null
var _clear_env: Environment
const BG_HFOV := 76.0      # the headset camera picture (same as room_mode.gd)

func _ready() -> void:
	vp = SubViewport.new()
	vp.size = Vector2i(854, 480)
	vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	vp.msaa_3d = Viewport.MSAA_2X
	add_child(vp)
	eye = Camera3D.new()
	eye.fov = 78.0
	eye.cull_mask = 0xFFFFF
	vp.add_child(eye)
	# 1.5: passthrough is not in the rendered picture: in "my room" the 3D is rendered with a transparent background
	# and laid over the headset camera picture here, in 2D (nothing is added to the 3D world, so the headset never
	# sees it)
	_clear_env = Environment.new()
	_clear_env.background_mode = Environment.BG_COLOR
	_clear_env.background_color = Color(0, 0, 0, 0)
	_clear_env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	_clear_env.ambient_light_color = Color(0.72, 0.72, 0.75)

func _process(_dt: float) -> void:
	if not enabled or src == null or muse == null or muse.state != "linked" or _pending:
		return
	# 1.6.12: only while Muse shows the view (the box in Muse, or a recording): rendering it costs the headset frames
	if not bool(muse.state_data.get("wantView", false)):
		return
	var now := Time.get_ticks_msec()
	if now < _next or muse.view_busy():
		return
	_next = now + int(1000.0 / FPS)
	# calm the head movement a little (a recording of raw head motion is hard to watch)
	var t := src.global_transform
	if _has:
		_xf = Transform3D(_xf.basis.orthonormalized().slerp(t.basis.orthonormalized(), 0.45), _xf.origin.lerp(t.origin, 0.5))
	else:
		_xf = t; _has = true
	eye.global_transform = _xf
	var bg: Image = bg_fn.call() if bg_fn.is_valid() else null
	vp.transparent_bg = bg != null
	eye.environment = _clear_env if bg != null else null
	if bg != null:
		# same field of view as the headset camera, so the 3D Carpathron stands where he is in your room
		var th := tan(deg_to_rad(BG_HFOV / 2.0))
		eye.fov = rad_to_deg(2.0 * atan(th * vp.size.y / vp.size.x))
	else:
		eye.fov = 78.0
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	_pending = true
	await RenderingServer.frame_post_draw
	_pending = false
	var img := vp.get_texture().get_image()
	if img == null or img.is_empty():
		return
	if bg != null:
		# the room picture (cropped to 16:9, same width as the 3D view) under the 3D with its transparency
		var out := bg.duplicate() as Image
		out.convert(Image.FORMAT_RGBA8)
		var w := vp.size.x
		var h := int(round(out.get_height() * float(w) / out.get_width()))
		out.resize(w, h, Image.INTERPOLATE_BILINEAR)
		out = out.get_region(Rect2i(0, (h - vp.size.y) / 2, w, vp.size.y))
		img.convert(Image.FORMAT_RGBA8)
		out.blend_rect(img, Rect2i(0, 0, vp.size.x, vp.size.y), Vector2i.ZERO)
		img = out
	muse.post_view(img.save_jpg_to_buffer(0.72), mode_fn.call() if mode_fn.is_valid() else "")
