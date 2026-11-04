.class public Lcom/carpathron/avatar/RoomCam$Dev;
.super Landroid/hardware/camera2/CameraDevice$StateCallback;

.field public o:Lcom/carpathron/avatar/RoomCam;

.method public constructor <init>(Lcom/carpathron/avatar/RoomCam;)V
    .locals 0
    invoke-direct {p0}, Landroid/hardware/camera2/CameraDevice$StateCallback;-><init>()V
    iput-object p1, p0, Lcom/carpathron/avatar/RoomCam$Dev;->o:Lcom/carpathron/avatar/RoomCam;
    return-void
.end method

.method public onOpened(Landroid/hardware/camera2/CameraDevice;)V
    .locals 4
    iget-object v0, p0, Lcom/carpathron/avatar/RoomCam$Dev;->o:Lcom/carpathron/avatar/RoomCam;
    iput-object p1, v0, Lcom/carpathron/avatar/RoomCam;->dev:Landroid/hardware/camera2/CameraDevice;
    :try_start_0
    new-instance v1, Ljava/util/ArrayList;
    invoke-direct {v1}, Ljava/util/ArrayList;-><init>()V
    iget-object v2, v0, Lcom/carpathron/avatar/RoomCam;->rd:Landroid/media/ImageReader;
    invoke-virtual {v2}, Landroid/media/ImageReader;->getSurface()Landroid/view/Surface;
    move-result-object v2
    invoke-virtual {v1, v2}, Ljava/util/ArrayList;->add(Ljava/lang/Object;)Z
    new-instance v2, Lcom/carpathron/avatar/RoomCam$Ses;
    invoke-direct {v2, v0}, Lcom/carpathron/avatar/RoomCam$Ses;-><init>(Lcom/carpathron/avatar/RoomCam;)V
    iget-object v3, v0, Lcom/carpathron/avatar/RoomCam;->h:Landroid/os/Handler;
    invoke-virtual {p1, v1, v2, v3}, Landroid/hardware/camera2/CameraDevice;->createCaptureSession(Ljava/util/List;Landroid/hardware/camera2/CameraCaptureSession$StateCallback;Landroid/os/Handler;)V
    const-string v1, "configuring"
    sput-object v1, Lcom/carpathron/avatar/RoomCam;->status:Ljava/lang/String;
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_0
    return-void
    :catch_0
    move-exception v1
    invoke-virtual {v1}, Ljava/lang/Object;->toString()Ljava/lang/String;
    move-result-object v1
    sput-object v1, Lcom/carpathron/avatar/RoomCam;->status:Ljava/lang/String;
    return-void
.end method

.method public onDisconnected(Landroid/hardware/camera2/CameraDevice;)V
    .locals 2
    invoke-virtual {p1}, Landroid/hardware/camera2/CameraDevice;->close()V
    iget-object v0, p0, Lcom/carpathron/avatar/RoomCam$Dev;->o:Lcom/carpathron/avatar/RoomCam;
    const/4 v1, 0x0
    iput-object v1, v0, Lcom/carpathron/avatar/RoomCam;->dev:Landroid/hardware/camera2/CameraDevice;
    iput-object v1, v0, Lcom/carpathron/avatar/RoomCam;->rd:Landroid/media/ImageReader;
    const-string v1, "disconnected"
    sput-object v1, Lcom/carpathron/avatar/RoomCam;->status:Ljava/lang/String;
    return-void
.end method

.method public onError(Landroid/hardware/camera2/CameraDevice;I)V
    .locals 3
    invoke-virtual {p1}, Landroid/hardware/camera2/CameraDevice;->close()V
    iget-object v0, p0, Lcom/carpathron/avatar/RoomCam$Dev;->o:Lcom/carpathron/avatar/RoomCam;
    const/4 v1, 0x0
    iput-object v1, v0, Lcom/carpathron/avatar/RoomCam;->dev:Landroid/hardware/camera2/CameraDevice;
    iput-object v1, v0, Lcom/carpathron/avatar/RoomCam;->rd:Landroid/media/ImageReader;
    new-instance v1, Ljava/lang/StringBuilder;
    const-string v2, "camera error "
    invoke-direct {v1, v2}, Ljava/lang/StringBuilder;-><init>(Ljava/lang/String;)V
    invoke-virtual {v1, p2}, Ljava/lang/StringBuilder;->append(I)Ljava/lang/StringBuilder;
    invoke-virtual {v1}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v1
    sput-object v1, Lcom/carpathron/avatar/RoomCam;->status:Ljava/lang/String;
    return-void
.end method
