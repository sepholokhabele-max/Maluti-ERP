# Activation codes (My Wallet only)

1. The business finishes KYC in **Settings → Activation & KYC** and sends you the request (or the KYC pack). It shows their **install ID**.
2. Check their KYC (or, for an existing agent / merchant, check the number in your records).
3. Make the code: `node make-code.js --key "<path to private-key.pem>" --install <INSTALL ID> --business "<name>" --days 365`
4. Send them the code (SMS / WhatsApp / email). They paste it under **Settings → Activation & KYC → Enter activation code**.

Leave out `--days` / `--expires` for a code without an end date. Codes only work for the install ID they were made for.
Keep `private-key.pem` secret and backed up – anyone with it can activate any copy; without it you cannot make codes.
