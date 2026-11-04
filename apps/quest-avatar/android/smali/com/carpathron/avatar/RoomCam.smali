.class public Lcom/carpathron/avatar/RoomCam;
.super Lorg/godotengine/godot/plugin/GodotPlugin;
.source "RoomCam.java"

# Carpathron Avatar 1.5: the Quest 3 / 3S passthrough camera (Meta Passthrough Camera API = Android Camera2).
# Godot singleton "CarpathronRoomCam": start(which) opens the camera, grab() returns the newest JPEG (640x480,
# about 1.4 per second), ageMs() / frames() / status() for the app. Written in smali so it builds without Gradle.

.field public static volatile last:[B
.field public static volatile lastAt:J
.field public static volatile status:Ljava/lang/String;
.field public static volatile nextAt:J
.field public static volatile frames:I

.field public th:Landroid/os/HandlerThread;
.field public h:Landroid/os/Handler;
.field public dev:Landroid/hardware/camera2/CameraDevice;
.field public rd:Landroid/media/ImageReader;
.field public ses:Landroid/hardware/camera2/CameraCaptureSession;

.method static constructor <clinit>()V
    .locals 1
    const-string v0, "off"
    sput-object v0, Lcom/carpathron/avatar/RoomCam;->status:Ljava/lang/String;
    const/4 v0, 0x0
    new-array v0, v0, [B
    sput-object v0, Lcom/carpathron/avatar/RoomCam;->last:[B
    return-void
.end method

.method public constructor <init>(Lorg/godotengine/godot/Godot;)V
    .locals 0
    invoke-direct {p0, p1}, Lorg/godotengine/godot/plugin/GodotPlugin;-><init>(Lorg/godotengine/godot/Godot;)V
    return-void
.end method

.method public getPluginName()Ljava/lang/String;
    .locals 1
    const-string v0, "CarpathronRoomCam"
    return-object v0
.end method

.method public status()Ljava/lang/String;
    .locals 1
    .annotation runtime Lorg/godotengine/godot/plugin/UsedByGodot;
    .end annotation
    sget-object v0, Lcom/carpathron/avatar/RoomCam;->status:Ljava/lang/String;
    return-object v0
.end method

.method public grab()[B
    .locals 1
    .annotation runtime Lorg/godotengine/godot/plugin/UsedByGodot;
    .end annotation
    sget-object v0, Lcom/carpathron/avatar/RoomCam;->last:[B
    return-object v0
.end method

.method public frames()I
    .locals 1
    .annotation runtime Lorg/godotengine/godot/plugin/UsedByGodot;
    .end annotation
    sget v0, Lcom/carpathron/avatar/RoomCam;->frames:I
    return v0
.end method

.method public ageMs()I
    .locals 4
    .annotation runtime Lorg/godotengine/godot/plugin/UsedByGodot;
    .end annotation
    invoke-static {}, Landroid/os/SystemClock;->uptimeMillis()J
    move-result-wide v0
    sget-wide v2, Lcom/carpathron/avatar/RoomCam;->lastAt:J
    sub-long/2addr v0, v2
    long-to-int v0, v0
    return v0
.end method

.method public cameras()Ljava/lang/String;
    .locals 3
    .annotation runtime Lorg/godotengine/godot/plugin/UsedByGodot;
    .end annotation
    :try_start_0
    invoke-virtual {p0}, Lorg/godotengine/godot/plugin/GodotPlugin;->getActivity()Landroid/app/Activity;
    move-result-object v0
    const-string v1, "camera"
    invoke-virtual {v0, v1}, Landroid/app/Activity;->getSystemService(Ljava/lang/String;)Ljava/lang/Object;
    move-result-object v0
    check-cast v0, Landroid/hardware/camera2/CameraManager;
    invoke-virtual {v0}, Landroid/hardware/camera2/CameraManager;->getCameraIdList()[Ljava/lang/String;
    move-result-object v0
    const-string v1, ","
    invoke-static {v1, v0}, Ljava/lang/String;->join(Ljava/lang/CharSequence;[Ljava/lang/CharSequence;)Ljava/lang/String;
    move-result-object v0
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_0
    return-object v0
    :catch_0
    move-exception v0
    invoke-virtual {v0}, Ljava/lang/Object;->toString()Ljava/lang/String;
    move-result-object v0
    return-object v0
.end method

.method public start(I)Ljava/lang/String;
    .locals 8
    .annotation runtime Lorg/godotengine/godot/plugin/UsedByGodot;
    .end annotation
    iget-object v0, p0, Lcom/carpathron/avatar/RoomCam;->rd:Landroid/media/ImageReader;
    if-eqz v0, :cond_open
    sget-object v0, Lcom/carpathron/avatar/RoomCam;->status:Ljava/lang/String;
    return-object v0
    :cond_open
    :try_start_0
    invoke-virtual {p0}, Lorg/godotengine/godot/plugin/GodotPlugin;->getActivity()Landroid/app/Activity;
    move-result-object v0
    const-string v1, "camera"
    invoke-virtual {v0, v1}, Landroid/app/Activity;->getSystemService(Ljava/lang/String;)Ljava/lang/Object;
    move-result-object v0
    check-cast v0, Landroid/hardware/camera2/CameraManager;
    invoke-virtual {v0}, Landroid/hardware/camera2/CameraManager;->getCameraIdList()[Ljava/lang/String;
    move-result-object v1
    array-length v2, v1
    if-nez v2, :cond_has
    const-string v3, "no camera"
    sput-object v3, Lcom/carpathron/avatar/RoomCam;->status:Ljava/lang/String;
    return-object v3
    :cond_has
    rem-int v3, p1, v2
    aget-object v3, v1, v3
    iget-object v4, p0, Lcom/carpathron/avatar/RoomCam;->th:Landroid/os/HandlerThread;
    if-nez v4, :cond_th
    new-instance v4, Landroid/os/HandlerThread;
    const-string v5, "roomcam"
    invoke-direct {v4, v5}, Landroid/os/HandlerThread;-><init>(Ljava/lang/String;)V
    invoke-virtual {v4}, Landroid/os/HandlerThread;->start()V
    iput-object v4, p0, Lcom/carpathron/avatar/RoomCam;->th:Landroid/os/HandlerThread;
    new-instance v5, Landroid/os/Handler;
    invoke-virtual {v4}, Landroid/os/HandlerThread;->getLooper()Landroid/os/Looper;
    move-result-object v6
    invoke-direct {v5, v6}, Landroid/os/Handler;-><init>(Landroid/os/Looper;)V
    iput-object v5, p0, Lcom/carpathron/avatar/RoomCam;->h:Landroid/os/Handler;
    :cond_th
    const/16 v4, 0x280
    const/16 v5, 0x1e0
    const/16 v6, 0x23
    const/4 v7, 0x2
    invoke-static {v4, v5, v6, v7}, Landroid/media/ImageReader;->newInstance(IIII)Landroid/media/ImageReader;
    move-result-object v4
    iput-object v4, p0, Lcom/carpathron/avatar/RoomCam;->rd:Landroid/media/ImageReader;
    new-instance v5, Lcom/carpathron/avatar/RoomCam$Img;
    invoke-direct {v5, p0}, Lcom/carpathron/avatar/RoomCam$Img;-><init>(Lcom/carpathron/avatar/RoomCam;)V
    iget-object v6, p0, Lcom/carpathron/avatar/RoomCam;->h:Landroid/os/Handler;
    invoke-virtual {v4, v5, v6}, Landroid/media/ImageReader;->setOnImageAvailableListener(Landroid/media/ImageReader$OnImageAvailableListener;Landroid/os/Handler;)V
    new-instance v5, Lcom/carpathron/avatar/RoomCam$Dev;
    invoke-direct {v5, p0}, Lcom/carpathron/avatar/RoomCam$Dev;-><init>(Lcom/carpathron/avatar/RoomCam;)V
    invoke-virtual {v0, v3, v5, v6}, Landroid/hardware/camera2/CameraManager;->openCamera(Ljava/lang/String;Landroid/hardware/camera2/CameraDevice$StateCallback;Landroid/os/Handler;)V
    new-instance v4, Ljava/lang/StringBuilder;
    const-string v5, "opening camera "
    invoke-direct {v4, v5}, Ljava/lang/StringBuilder;-><init>(Ljava/lang/String;)V
    invoke-virtual {v4, v3}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v4}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v4
    sput-object v4, Lcom/carpathron/avatar/RoomCam;->status:Ljava/lang/String;
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_0
    sget-object v0, Lcom/carpathron/avatar/RoomCam;->status:Ljava/lang/String;
    return-object v0
    :catch_0
    move-exception v0
    const/4 v1, 0x0
    iput-object v1, p0, Lcom/carpathron/avatar/RoomCam;->rd:Landroid/media/ImageReader;
    invoke-virtual {v0}, Ljava/lang/Object;->toString()Ljava/lang/String;
    move-result-object v0
    sput-object v0, Lcom/carpathron/avatar/RoomCam;->status:Ljava/lang/String;
    return-object v0
.end method

.method public stop()V
    .locals 2
    .annotation runtime Lorg/godotengine/godot/plugin/UsedByGodot;
    .end annotation
    :try_start_0
    iget-object v0, p0, Lcom/carpathron/avatar/RoomCam;->dev:Landroid/hardware/camera2/CameraDevice;
    if-eqz v0, :cond_a
    invoke-virtual {v0}, Landroid/hardware/camera2/CameraDevice;->close()V
    :cond_a
    iget-object v0, p0, Lcom/carpathron/avatar/RoomCam;->rd:Landroid/media/ImageReader;
    if-eqz v0, :cond_b
    invoke-virtual {v0}, Landroid/media/ImageReader;->close()V
    :cond_b
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_0
    :catch_0
    const/4 v1, 0x0
    iput-object v1, p0, Lcom/carpathron/avatar/RoomCam;->dev:Landroid/hardware/camera2/CameraDevice;
    iput-object v1, p0, Lcom/carpathron/avatar/RoomCam;->ses:Landroid/hardware/camera2/CameraCaptureSession;
    iput-object v1, p0, Lcom/carpathron/avatar/RoomCam;->rd:Landroid/media/ImageReader;
    const-string v0, "off"
    sput-object v0, Lcom/carpathron/avatar/RoomCam;->status:Ljava/lang/String;
    return-void
.end method

# YUV_420_888 -> NV21 -> JPEG (quality 70)
.method public static toJpeg(Landroid/media/Image;)[B
    .locals 15
    invoke-virtual {p0}, Landroid/media/Image;->getWidth()I
    move-result v0
    invoke-virtual {p0}, Landroid/media/Image;->getHeight()I
    move-result v1
    invoke-virtual {p0}, Landroid/media/Image;->getPlanes()[Landroid/media/Image$Plane;
    move-result-object v2
    mul-int v3, v0, v1
    div-int/lit8 v4, v3, 0x2
    add-int/2addr v4, v3
    new-array v4, v4, [B
    const/4 v5, 0x0
    aget-object v5, v2, v5
    invoke-virtual {v5}, Landroid/media/Image$Plane;->getBuffer()Ljava/nio/ByteBuffer;
    move-result-object v6
    invoke-virtual {v5}, Landroid/media/Image$Plane;->getRowStride()I
    move-result v7
    const/4 v8, 0x0
    :goto_y
    if-ge v8, v1, :cond_ydone
    mul-int v9, v8, v7
    invoke-virtual {v6, v9}, Ljava/nio/Buffer;->position(I)Ljava/nio/Buffer;
    mul-int v9, v8, v0
    invoke-virtual {v6, v4, v9, v0}, Ljava/nio/ByteBuffer;->get([BII)Ljava/nio/ByteBuffer;
    add-int/lit8 v8, v8, 0x1
    goto :goto_y
    :cond_ydone
    move v10, v3
    const/4 v5, 0x1
    aget-object v5, v2, v5
    invoke-virtual {v5}, Landroid/media/Image$Plane;->getBuffer()Ljava/nio/ByteBuffer;
    move-result-object v6
    invoke-virtual {v5}, Landroid/media/Image$Plane;->getRowStride()I
    move-result v7
    invoke-virtual {v5}, Landroid/media/Image$Plane;->getPixelStride()I
    move-result v8
    const/4 v5, 0x2
    aget-object v5, v2, v5
    invoke-virtual {v5}, Landroid/media/Image$Plane;->getBuffer()Ljava/nio/ByteBuffer;
    move-result-object v9
    div-int/lit8 v11, v1, 0x2
    div-int/lit8 v12, v0, 0x2
    const/4 v13, 0x0
    :goto_r
    if-ge v13, v11, :cond_rdone
    const/4 v14, 0x0
    :goto_c
    if-ge v14, v12, :cond_cdone
    mul-int v3, v13, v7
    mul-int v5, v14, v8
    add-int/2addr v3, v5
    invoke-virtual {v9, v3}, Ljava/nio/ByteBuffer;->get(I)B
    move-result v5
    aput-byte v5, v4, v10
    add-int/lit8 v10, v10, 0x1
    invoke-virtual {v6, v3}, Ljava/nio/ByteBuffer;->get(I)B
    move-result v5
    aput-byte v5, v4, v10
    add-int/lit8 v10, v10, 0x1
    add-int/lit8 v14, v14, 0x1
    goto :goto_c
    :cond_cdone
    add-int/lit8 v13, v13, 0x1
    goto :goto_r
    :cond_rdone
    new-instance v5, Landroid/graphics/YuvImage;
    move-object v6, v4
    const/16 v7, 0x11
    move v8, v0
    move v9, v1
    const/4 v10, 0x0
    invoke-direct/range {v5 .. v10}, Landroid/graphics/YuvImage;-><init>([BIII[I)V
    new-instance v6, Ljava/io/ByteArrayOutputStream;
    invoke-direct {v6}, Ljava/io/ByteArrayOutputStream;-><init>()V
    new-instance v7, Landroid/graphics/Rect;
    const/4 v8, 0x0
    invoke-direct {v7, v8, v8, v0, v1}, Landroid/graphics/Rect;-><init>(IIII)V
    const/16 v8, 0x46
    invoke-virtual {v5, v7, v8, v6}, Landroid/graphics/YuvImage;->compressToJpeg(Landroid/graphics/Rect;ILjava/io/OutputStream;)Z
    invoke-virtual {v6}, Ljava/io/ByteArrayOutputStream;->toByteArray()[B
    move-result-object v0
    return-object v0
.end method
