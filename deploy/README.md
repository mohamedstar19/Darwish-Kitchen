# نشر Darwish Kitchen على سيرفر درويش

التطبيق بيتنشر على نفس سيرفر منصة القرآن، على الدومين **kitchen.darwish-tech.com**:

| الجزء | المكان على السيرفر |
| --- | --- |
| نسخة الويب (للآيفون وأي متصفح) | `/opt/darwish-kitchen/web` بيخدمها nginx |
| سيرفر النسخ الاحتياطي (API) | `/opt/darwish-kitchen/server` على `127.0.0.1:3020` عن طريق PM2 باسم `kitchen` |
| البيانات (الحسابات + النسخ + الصور) | `/opt/darwish-kitchen/data` (SQLite + مجلد صور) — **مش بيتمسح أبدًا مع التحديث** |
| نسخة ليلية من البيانات | `/opt/darwish-kitchen/backups` (آخر 14 يوم، الساعة 3:15 الفجر) |

## أول مرة وكل تحديث — نفس الأمر

من جهازك (اللي عليه نسخة الريبو و Node 22):

```bash
bash deploy/update.sh <IP السيرفر>
# مثال:
bash deploy/update.sh 192.168.1.116
```

السكربت بيبني نسخة الويب على جهازك، ويرفعها هي وسيرفر الـ API، وبيشغّل `deploy/install.sh` على السيرفر. السكربت ده بيثبّت أي حاجة ناقصة (Node 22.13+، nginx، PM2، rsync)، ويعمل مستخدم `kitchen`، ويشغّل الـ API، ويضيف موقع nginx. تقدر تشغّله أكتر من مرة بأمان.

## مرة واحدة في Cloudflare

ضيف **kitchen.darwish-tech.com** بنفس طريقة `quran.darwish-tech.com`:
- لو بتستخدم Cloudflare Tunnel: Zero Trust → Networks → Tunnels → التانل بتاع السيرفر → **Public Hostname** جديد: `kitchen` . `darwish-tech.com` → `http://localhost:80`.
- SSL من Cloudflare زي باقي المواقع.

بعدها افتح `https://kitchen.darwish-tech.com/api/health` — المفروض يرجع `{"ok":true}`.

## أوامر مفيدة على السيرفر

```bash
sudo -u kitchen pm2 logs kitchen      # سجلات الـ API
sudo -u kitchen pm2 restart kitchen   # إعادة تشغيل
ls /opt/darwish-kitchen/backups       # النسخ الليلية
```

## استرجاع البيانات من نسخة ليلية

```bash
sudo -u kitchen pm2 stop kitchen
cd /opt/darwish-kitchen/data && sudo tar -xzf ../backups/kitchen-YYYY-MM-DD.tar.gz
sudo chown -R kitchen:kitchen /opt/darwish-kitchen/data
sudo -u kitchen pm2 start kitchen
```

## تطبيق الموبايل

تطبيق أندرويد/آيفون بيكلّم `https://kitchen.darwish-tech.com` تلقائيًا. لو حبيت تجرّب على سيرفر تاني حط `EXPO_PUBLIC_API_URL` في ملف `.env` (شوف `.env.example`).
