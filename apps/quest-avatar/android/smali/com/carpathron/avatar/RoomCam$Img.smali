.class public Lcom/carpathron/avatar/RoomCam$Img;
.super Ljava/lang/Object;
.implements Landroid/media/ImageReader$OnImageAvailableListener;

.field public o:Lcom/carpathron/avatar/RoomCam;

.method public constructor <init>(Lcom/carpathron/avatar/RoomCam;)V
    .locals 0
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    iput-object p1, p0, Lcom/carpathron/avatar/RoomCam$Img;->o:Lcom/carpathron/avatar/RoomCam;
    return-void
.end method

# keeps one JPEG about every 700 ms; every other picture is only released
.method public onImageAvailable(Landroid/media/ImageReader;)V
    .locals 6
    :try_start_0
    invoke-virtual {p1}, Landroid/media/ImageReader;->acquireLatestImage()Landroid/media/Image;
    move-result-object v0
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_0
    if-nez v0, :cond_got
    return-void
    :cond_got
    :try_start_1
    invoke-static {}, Landroid/os/SystemClock;->uptimeMillis()J
    move-result-wide v1
    sget-wide v3, Lcom/carpathron/avatar/RoomCam;->nextAt:J
    cmp-long v5, v1, v3
    if-ltz v5, :cond_skip
    const-wide/16 v3, 0xfa
    add-long/2addr v3, v1
    sput-wide v3, Lcom/carpathron/avatar/RoomCam;->nextAt:J
    invoke-static {v0}, Lcom/carpathron/avatar/RoomCam;->toJpeg(Landroid/media/Image;)[B
    move-result-object v3
    sput-object v3, Lcom/carpathron/avatar/RoomCam;->last:[B
    sput-wide v1, Lcom/carpathron/avatar/RoomCam;->lastAt:J
    sget v3, Lcom/carpathron/avatar/RoomCam;->frames:I
    add-int/lit8 v3, v3, 0x1
    sput v3, Lcom/carpathron/avatar/RoomCam;->frames:I
    :cond_skip
    :try_end_1
    .catch Ljava/lang/Throwable; {:try_start_1 .. :try_end_1} :catch_1
    invoke-virtual {v0}, Landroid/media/Image;->close()V
    return-void
    :catch_1
    move-exception v1
    invoke-virtual {v1}, Ljava/lang/Object;->toString()Ljava/lang/String;
    move-result-object v1
    sput-object v1, Lcom/carpathron/avatar/RoomCam;->status:Ljava/lang/String;
    invoke-virtual {v0}, Landroid/media/Image;->close()V
    return-void
    :catch_0
    move-exception v0
    return-void
.end method
