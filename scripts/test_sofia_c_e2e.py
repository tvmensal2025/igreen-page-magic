#!/usr/bin/env python3
"""E2E sandbox — Sofia Multicanal (variant C) via whapi-webhook testMode."""
import json
import os
import sys
import time
import uuid
import urllib.request
import urllib.error

PROJECT_REF = "zlzasfhcxcznaprrragl"
REST = f"https://{PROJECT_REF}.supabase.co/rest/v1"
WEBHOOK = f"https://{PROJECT_REF}.supabase.co/functions/v1/whapi-webhook"

SR = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ANON = os.environ["SUPABASE_ANON_KEY"]

PHONE = "550000021189303"
CUSTOMER = "915daf02-8765-4b89-a90c-6cd64c23e6d5"
CONSULTANT = "0c2711ad-4836-41e6-afba-edd94f698ae3"
FLOW_C = "59f53614-196c-4b6f-a029-59fadca78bd7"
TEST_IMG_B64 = "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAHUlEQVR4nGP8//8/A7mAiWydo5pHNY9qHtVMFc0AnKADJXYG/XsAAAAASUVORK5CYII="

PASS_STEPS = {
    "aguardando_conta", "confirmando_dados_conta", "aguardando_doc_auto",
    "aguardando_doc_frente", "aguardando_doc_verso", "confirmando_dados_doc",
    "ask_email", "ask_phone", "ask_telefone", "confirmar_telefone",
    "confirm_phone", "finalizando", "aguardando_otp", "validando_otp",
    "validacao_facial", "aguardando_facial", "portal_submitting", "complete",
}
FAIL_PATTERNS = ("flow:975c4ab2", "a3_explain")  # stuck on a3


def rest(method, path, body=None, params=None):
    url = f"{REST}/{path}"
    if params:
        url += "?" + params
    h = {
        "apikey": SR,
        "Authorization": f"Bearer {SR}",
        "Content-Type": "application/json",
    }
    req = urllib.request.Request(
        url,
        method=method,
        headers=h,
        data=json.dumps(body).encode() if body is not None else None,
    )
    try:
        text = urllib.request.urlopen(req, timeout=60).read().decode()
        return json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        return {"_error": e.code, "_body": e.read().decode()[:400]}


def get_customer():
    rows = rest("GET", "customers", params=f"id=eq.{CUSTOMER}&select=*")
    return rows[0] if isinstance(rows, list) and rows else {}


def reset_customer():
    rest("DELETE", "customer_flow_state", params=f"customer_id=eq.{CUSTOMER}")
    rest("DELETE", "conversations", params=f"customer_id=eq.{CUSTOMER}")
    rest("PATCH", "customers", body={
        "name": None,
        "conversation_step": None,
        "capture_mode": "auto",
        "bot_paused": False,
        "bot_paused_reason": None,
        "assigned_human_id": None,
        "flow_variant": "C",
        "is_sandbox": True,
        "electricity_bill_value": None,
        "bill_data_confirmed_at": None,
        "doc_data_confirmed_at": None,
        "email": None,
        "cpf": None,
        "rg": None,
        "status": "pending",
        "link_facial": None,
        "otp_code": None,
        "ocr_conta_attempts": 0,
        "ocr_doc_attempts": 0,
    }, params=f"id=eq.{CUSTOMER}")


def webhook(payload, run_id, turn):
    h = {
        "Authorization": f"Bearer {ANON}",
        "apikey": ANON,
        "Content-Type": "application/json",
        "x-bot-test-run-id": run_id,
        "x-bot-test-turn": str(turn),
        "x-bot-bypass-quiet-hours": "1",
        "x-bot-fast-clock": "1",
    }
    req = urllib.request.Request(WEBHOOK, headers=h, data=json.dumps(payload).encode())
    t0 = time.time()
    try:
        body = urllib.request.urlopen(req, timeout=180).read().decode()
        return {"ok": True, "elapsed": time.time() - t0, "body": body}
    except Exception as e:
        return {"ok": False, "elapsed": time.time() - t0, "error": str(e)}


def msg_text(text, run_id, turn):
    ts = int(time.time())
    payload = {
        "messages": [{
            "id": f"e2e_{ts}_{turn}", "from_me": False, "type": "text",
            "chat_id": f"{PHONE}@s.whatsapp.net", "from": PHONE,
            "timestamp": ts, "from_name": "Maria", "text": {"body": text},
        }],
        "event": {"type": "messages"},
    }
    return webhook(payload, run_id, turn)


def msg_button(button_id, title, run_id, turn):
    ts = int(time.time())
    payload = {
        "messages": [{
            "id": f"e2e_{ts}_{turn}", "from_me": False, "type": "reply",
            "chat_id": f"{PHONE}@s.whatsapp.net", "from": PHONE,
            "timestamp": ts, "from_name": "Maria",
            "reply": {"type": "buttons_reply",
                      "buttons_reply": {"id": button_id, "title": title}},
        }],
        "event": {"type": "messages"},
    }
    return webhook(payload, run_id, turn)


def msg_image(run_id, turn):
    ts = int(time.time())
    payload = {
        "messages": [{
            "id": f"e2e_{ts}_{turn}", "from_me": False, "type": "image",
            "chat_id": f"{PHONE}@s.whatsapp.net", "from": PHONE,
            "timestamp": ts, "from_name": "Maria",
            "image": {
                "mime_type": "image/png",
                "data": TEST_IMG_B64,
                "link": f"data:image/png;base64,{TEST_IMG_B64}",
            },
        }],
        "event": {"type": "messages"},
    }
    return webhook(payload, run_id, turn)


def step_label(c):
    s = str(c.get("conversation_step") or "null")
    if s.startswith("flow:"):
        return s[:20] + "…"
    return s


def inject_ocr_conta_if_stuck():
    """Sandbox: se OCR da conta não rodar (imagem mínima), injeta dados e confirma."""
    c = get_customer()
    step = str(c.get("conversation_step") or "")
    if step not in ("aguardando_conta", "processando_ocr_conta"):
        return False
    rest("PATCH", "customers", body={
        "name": "Maria Silva",
        "cpf": "52998224725",
        "address_street": "Rua Teste",
        "address_number": "100",
        "address_neighborhood": "Centro",
        "address_city": "Belo Horizonte",
        "address_state": "MG",
        "address_zip": "30130000",
        "electricity_bill_value": 350,
        "media_consumo": 320,
        "conversation_step": "confirmando_dados_conta",
    }, params=f"id=eq.{CUSTOMER}")
    return True


def inject_ocr_doc_if_stuck():
    c = get_customer()
    step = str(c.get("conversation_step") or "")
    if step not in ("aguardando_doc_auto", "aguardando_doc_frente", "aguardando_doc_verso", "aguardando_conta"):
        return False
    if step == "aguardando_conta":
        return False
    rest("PATCH", "customers", body={
        "rg": "123456789",
        "data_nascimento": "01/01/1990",
        "document_type": "rg_novo",
        "conversation_step": "confirmando_dados_doc",
    }, params=f"id=eq.{CUSTOMER}")
    return True


def main():
    print("=" * 70)
    print("E2E Sofia C — sandbox", PHONE)
    print("=" * 70)

    reset_customer()
    run_id = str(uuid.uuid4())
    rest("POST", "bot_test_runs", body={
        "id": run_id,
        "status": "running",
        "customer_id": CUSTOMER,
        "consultant_id": CONSULTANT,
        "scenario": "sofia_c_full_e2e",
        "created_by": "00000000-0000-0000-0000-000000000000",
    })

    script = [
        ("oi", "text"),
        ("Maria", "text"),
        ("350", "text"),
        ("activate", "button:Quero ativar"),
        ("foto_conta", "image"),
        ("sim_conta", "button:✅ SIM"),
        ("foto_doc", "image"),
        ("sim_doc", "button:✅ SIM"),
        ("maria.silva@teste.com", "text"),
        ("sim", "text"),
        ("123456", "text"),
        ("PRONTO", "text"),
    ]

    results = []
    turn = 0
    for label, kind in script:
        turn += 1
        print(f"\n[{turn}] {label} ({kind})")
        if kind == "text":
            r = msg_text(label if kind == "text" else label, run_id, turn)
        elif kind.startswith("button:"):
            bid = label
            title = kind.split(":", 1)[1]
            r = msg_button(bid, title, run_id, turn)
        elif kind == "image":
            r = msg_image(run_id, turn)
            time.sleep(4)
            if inject_ocr_conta_if_stuck():
                print("    [stub] OCR conta → confirmando_dados_conta")
            if inject_ocr_doc_if_stuck():
                print("    [stub] OCR doc → confirmando_dados_doc")
        else:
            r = msg_text(label, run_id, turn)

        time.sleep(2)
        c = get_customer()
        step = step_label(c)
        print(f"    HTTP {r.get('elapsed', 0):.1f}s step={step} paused={c.get('bot_paused')}")
        if not r.get("ok"):
            print(f"    ERRO: {r.get('error')}")
            results.append((label, False, step))
            break

        stuck_a3 = any(p in str(c.get("conversation_step") or "") for p in FAIL_PATTERNS)
        if label == "activate" and stuck_a3:
            print("    FALHA: ainda no a3 após Quero ativar")
            results.append((label, False, step))
            break
        if label == "activate" and step in ("aguardando_conta",) or "f21b3d40" in str(c.get("conversation_step") or ""):
            print("    OK a3→a6")
        results.append((label, True, step))

    c = get_customer()
    final_step = str(c.get("conversation_step") or "")
    print("\n" + "=" * 70)
    print("ESTADO FINAL")
    print(f"  step: {final_step}")
    print(f"  status: {c.get('status')}")
    print(f"  flow_variant: {c.get('flow_variant')}")
    print(f"  email: {c.get('email')}")
    print(f"  link_facial: {c.get('link_facial')}")

    out = rest("GET", "bot_test_outbound", params=f"run_id=eq.{run_id}&order=created_at.asc&limit=30")
    if isinstance(out, list):
        print(f"\n  outbounds: {len(out)} eventos")
        for o in out[-8:]:
            k = o.get("kind")
            t = (o.get("content") or "")[:60].replace("\n", " ")
            print(f"    turn={o.get('turn')} {k}: {t}")

    success = (
        final_step in PASS_STEPS
        or "otp" in final_step
        or "facial" in final_step
        or final_step == "complete"
        or final_step.startswith("flow:d3f9b3c8")  # a10 portal OTP
    )
    a3_ok = any(s == "aguardando_conta" for l, _, s in results if l == "activate")
    print(f"  a3→a6 (Quero ativar): {'OK' if a3_ok else 'FALHOU'}")

    print("\n" + ("✅ E2E PASSOU" if success else "❌ E2E FALHOU (ver step final)"))
    return 0 if (success and a3_ok) else 1


if __name__ == "__main__":
    sys.exit(main())
