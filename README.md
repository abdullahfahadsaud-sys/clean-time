# Clean Time

نسخة آمنة محلية من النظام تعمل على `Python 3` مع:

- تسجيل دخول وجلسات على السيرفر
- كلمات مرور مشفّرة
- قاعدة بيانات `SQLite`
- صلاحيات `admin` و `team`
- منع الوصول للطلبات وأرقام العملاء بدون تسجيل دخول

## التشغيل

```bash
python3 server.py
```

سيفتح التطبيق على:

```text
http://127.0.0.1:8000
```

## إنشاء المستخدمين

إنشاء مستخدم جديد:

```bash
python3 server.py create-user --username team2 --role team --name "الفريق الثاني"
```

إعادة تعيين كلمة المرور:

```bash
python3 server.py reset-password --username admin
```

عرض المستخدمين الحاليين:

```bash
python3 server.py list-users
```

## ملاحظات أمان

- البيانات لم تعد محفوظة في `localStorage` أو `sessionStorage`.
- أرقام العملاء لا تُرجع من السيرفر إلا للمستخدمين المصرح لهم.
- لوحة الأدمن والعمليات والتقارير محمية بصلاحيات على مستوى السيرفر.
- يمكن تفعيل `Secure` للكوكيز عند التشغيل خلف HTTPS عبر:

```bash
CT_SECURE_COOKIE=1 python3 server.py
```
