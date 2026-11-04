.class public Lcom/carpathron/avatar/RoomCam$Ses;
.super Landroid/hardware/camera2/CameraCaptureSession$StateCallback;

.field public o:Lcom/carpathron/avatar/RoomCam;

.method public constructor <init>(Lcom/carpathron/avatar/RoomCam;)V
    .locals 0
    invoke-direct {p0}, Landroid/hardware/camera2/CameraCaptureSession$StateCallback;-><init>()V
    iput-object p1, p0, Lcom/carpathron/avatar/RoomCam$Ses;->o:Lcom/carpathron/avatar/RoomCam;
    return-void
.end method

.method public onConfigured(Landroid/hardware/camera2/CameraCaptureSession;)V
    .locals 4
    iget-object v0, p0, Lcom/carpathron/avatar/RoomCam$Ses;->o:Lcom/carpathron/avatar/RoomCam;
    iput-object p1, v0, Lcom/carpathron/avatar/RoomCam;->ses:Landroid/hardware/camera2/CameraCaptureSession;
    :try_start_0
    iget-object v1, v0, Lcom/carpathron/avatar/RoomCam;->dev:Landroid/hardware/camera2/CameraDevice;
    const/4 v2, 0x1
    invoke-virtual {v1, v2}, Landroid/hardware/camera2/CameraDevice;->createCaptureRequest(I)Landroid/hardware/camera2/CaptureRequest$Builder;
    move-result-object v1
    iget-object v2, v0, Lcom/carpathron/avatar/RoomCam;->rd:Landroid/media/ImageReader;
    invoke-virtual {v2}, Landroid/media/ImageReader;->getSurface()Landroid/view/Surface;
    move-result-object v2
    invoke-virtual {v1, v2}, Landroid/hardware/camera2/CaptureRequest$Builder;->addTarget(Landroid/view/Surface;)V
    invoke-virtual {v1}, Landroid/hardware/camera2/CaptureRequest$Builder;->build()Landroid/hardware/camera2/CaptureRequest;
    move-result-object v1
    const/4 v2, 0x0
    iget-object v3, v0, Lcom/carpathron/avatar/RoomCam;->h:Landroid/os/Handler;
    invoke-virtual {p1, v1, v2, v3}, Landroid/hardware/camera2/CameraCaptureSession;->setRepeatingRequest(Landroid/hardware/camera2/CaptureRequest;Landroid/hardware/camera2/CameraCaptureSession$CaptureCallback;Landroid/os/Handler;)I
    const-string v1, "on"
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

.method public onConfigureFailed(Landroid/hardware/camera2/CameraCaptureSession;)V
    .locals 1
    const-string v0, "camera session failed"
    sput-object v0, Lcom/carpathron/avatar/RoomCam;->status:Ljava/lang/String;
    return-void
.end method
