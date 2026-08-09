-- Hold（仮押さえ）に主催者カレンダー上の「[調整中]」仮予定のイベントIDを持たせる。
-- 相手が枠を仮押さえした瞬間にGoogleカレンダー上にも見えるようにするため（社長要望・Spir同様）。
-- 既存行は NULL のまま＝そのHoldに紐づく仮予定は無い（degrade-safe）。

-- AlterTable
ALTER TABLE "Hold" ADD COLUMN "googleEventId" TEXT;
