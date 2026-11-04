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

func _process(_dt: float) -> void:
	if not enabled or src == null or muse == null or muse.state != "linked" or _pending:
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
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	_pending = true
	await RenderingServer.frame_post_draw
	_pending = false
	var img := vp.get_texture().get_image()
	if img == null or img.is_empty():
		return
	muse.post_view(img.save_jpg_to_buffer(0.72), mode_fn.call() if mode_fn.is_valid() else "")
