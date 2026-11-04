.class public Lcom/carpathron/avatar/RoomCam$TtsProg;
.super Landroid/speech/tts/UtteranceProgressListener;

.method public constructor <init>()V
    .locals 0
    invoke-direct {p0}, Landroid/speech/tts/UtteranceProgressListener;-><init>()V
    return-void
.end method

.method public onStart(Ljava/lang/String;)V
    .locals 0
    return-void
.end method

.method public onDone(Ljava/lang/String;)V
    .locals 2
    sget-object v0, Lcom/carpathron/avatar/RoomCam;->ttsDone:Ljava/util/concurrent/ConcurrentHashMap;
    const-string v1, "done"
    invoke-virtual {v0, p1, v1}, Ljava/util/concurrent/ConcurrentHashMap;->put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;
    return-void
.end method

.method public onError(Ljava/lang/String;)V
    .locals 2
    sget-object v0, Lcom/carpathron/avatar/RoomCam;->ttsDone:Ljava/util/concurrent/ConcurrentHashMap;
    const-string v1, "error"
    invoke-virtual {v0, p1, v1}, Ljava/util/concurrent/ConcurrentHashMap;->put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;
    return-void
.end method
