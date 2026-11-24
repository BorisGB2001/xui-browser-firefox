XUI Browser Client для Windows
==============================

Неофициальный VPN-клиент для серверов панели 3x-ui (Xray: VLESS, VMess, Trojan,
Shadowsocks) для Firefox: через VPN идёт только трафик браузера.

Что в архиве
  xui_host.exe      помощник: запускает и останавливает туннель xray-core
  install.cmd       установка помощника (двойной щелчок)
  uninstall.cmd     удаление помощника
  install.ps1, uninstall.ps1   сами сценарии установки и удаления
  *.xpi             расширение Firefox

Два варианта
  Лёгкий: только расширение (.xpi), без install.cmd. Работают серверы типа «HTTPS-прокси»
    (inbound HTTP с TLS в 3x-ui). Ничего, кроме расширения, на компьютер не ставится.
  Полный: расширение + помощник (install.cmd). Нужен для ссылок vless://, vmess://,
    trojan://, ss:// и подписок, в том числе VLESS через XHTTP/WebSocket и Cloudflare.
    Помощник можно доустановить позже — расширение само скажет, когда он нужен.

Установка (полный вариант; для лёгкого — только шаг 3)
  1. Распакуйте архив в любую папку.
  2. Запустите install.cmd. Права администратора не нужны.
     Сценарий скачает xray-core v26.11.9 с GitHub (XTLS/Xray-core, Xray-windows-64.zip)
     и сверит контрольную сумму SHA-256. Если интернета нет или GitHub недоступен —
     положите xray.exe рядом с install.cmd.
     Если Windows SmartScreen предупредит о неизвестном издателе — «Подробнее» →
     «Выполнить в любом случае» (файлы не подписаны сертификатом Microsoft).
     Антивирус может ругаться на xray.exe как на «прокси-программу» — это ожидаемо.
  3. Перезапустите Firefox и установите расширение:
     - подписанный файл (…-signed.xpi): перетащите его в окно Firefox;
     - неподписанный файл обычный Firefox не установит. Для проверки: about:debugging →
       «Этот Firefox» → «Загрузить временное дополнение» → выберите .xpi
       (работает до закрытия Firefox).
  4. В настройках расширения: «Добавить сервер» → вставьте ссылку (vless://, vmess://,
     trojan://, ss://) или адрес подписки → выберите сервер → включите VPN в окне расширения.

Где лежат данные
  %LOCALAPPDATA%\XUI-Browser\profiles   ссылки серверов с ключами
  %LOCALAPPDATA%\XUI-Browser\logs       журнал xray
  Реестр: HKCU\Software\Mozilla\NativeMessagingHosts\xui_browser

Исходный код: https://github.com/BorisGB2001/xui-browser-firefox

Удаление
  uninstall.cmd — удаляет помощник, серверы остаются.
  Полностью: powershell -ExecutionPolicy Bypass -File uninstall.ps1 -Purge
