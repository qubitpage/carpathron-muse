.class public Lcom/carpathron/avatar/RoomCam$TtsInit;
.super Ljava/lang/Object;
.implements Landroid/speech/tts/TextToSpeech$OnInitListener;

.method public constructor <init>()V
    .locals 0
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    return-void
.end method

.method public onInit(I)V
    .locals 2
    if-nez p1, :cond_bad
    const-string v0, "ready"
    sput-object v0, Lcom/carpathron/avatar/RoomCam;->ttsStatus:Ljava/lang/String;
    return-void
    :cond_bad
    new-instance v0, Ljava/lang/StringBuilder;
    const-string v1, "no speech engine ("
    invoke-direct {v0, v1}, Ljava/lang/StringBuilder;-><init>(Ljava/lang/String;)V
    invoke-virtual {v0, p1}, Ljava/lang/StringBuilder;->append(I)Ljava/lang/StringBuilder;
    const-string v1, ")"
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v0}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v0
    sput-object v0, Lcom/carpathron/avatar/RoomCam;->ttsStatus:Ljava/lang/String;
    return-void
.end method
