"""Generate redacted signing parity evidence from one pinned official SDK."""

import json
import subprocess
import sys

import msgpack
from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils import keccak, to_hex
from hyperliquid.utils.signing import (
    action_hash,
    construct_phantom_agent,
    l1_payload,
    sign_agent,
    user_signed_payload,
)

SDK_TAG = "0.24.0"
SDK_COMMIT = "2fdb18f9517675ea03695a0962bd19eece9c83f0"
SIGNER_LABEL = "hyper-trader-u6-official-parity-v1"
NONCE = 1_725_000_000_000
EXPIRES_AFTER = 1_725_000_015_000
CLOID = "0x00000000000000000000000000000001"


def require_pinned_checkout(path: str) -> None:
    actual = subprocess.check_output(
        ["git", "-C", path, "rev-parse", "HEAD"], text=True
    ).strip()
    if actual != SDK_COMMIT:
        raise SystemExit(f"expected SDK {SDK_COMMIT}, received {actual}")


def actions():
    return {
        "marketOrder": {
            "type": "order",
            "orders": [{"a": 1, "b": True, "p": "100", "s": "100", "r": False, "t": {"limit": {"tif": "Ioc"}}, "c": CLOID}],
            "grouping": "na",
        },
        "limitOrder": {
            "type": "order",
            "orders": [{"a": 1, "b": False, "p": "101.25", "s": "0.5", "r": False, "t": {"limit": {"tif": "Gtc"}}, "c": CLOID}],
            "grouping": "na",
        },
        "cancelByOid": {"type": "cancel", "cancels": [{"a": 1, "o": 42}]},
        "cancelByCloid": {"type": "cancelByCloid", "cancels": [{"asset": 1, "cloid": CLOID}]},
        "bulkCancelByOid": {"type": "cancel", "cancels": [{"a": 1, "o": 42}, {"a": 10001, "o": 43}]},
        "bulkCancelByCloid": {"type": "cancelByCloid", "cancels": [{"asset": 1, "cloid": CLOID}, {"asset": 10001, "cloid": "0x00000000000000000000000000000002"}]},
        "updateLeverage": {"type": "updateLeverage", "asset": 1, "isCross": False, "leverage": 5},
        "reduceOnlyClose": {
            "type": "order",
            "orders": [{"a": 1, "b": False, "p": "99", "s": "2", "r": True, "t": {"limit": {"tif": "Ioc"}}, "c": CLOID}],
            "grouping": "na",
        },
        "positionTpslCreate": {
            "type": "order",
            "orders": [{"a": 1, "b": False, "p": "104.5", "s": "0", "r": True, "t": {"trigger": {"isMarket": True, "triggerPx": "110", "tpsl": "tp"}}, "c": CLOID}],
            "grouping": "positionTpsl",
        },
        "positionTpslModify": {
            "type": "modify",
            "oid": 77,
            "order": {"a": 1, "b": False, "p": "85.5", "s": "0", "r": True, "t": {"trigger": {"isMarket": True, "triggerPx": "90", "tpsl": "sl"}}, "c": CLOID},
        },
    }


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: generate.py /path/to/pinned-sdk")
    require_pinned_checkout(sys.argv[1])
    wallet = Account.from_key(keccak(text=SIGNER_LABEL))
    agent = Account.from_key(keccak(text="hyper-trader-u6-agent-address-v1"))
    result = {
        "provenance": {
            "sdkTag": SDK_TAG,
            "sdkCommit": SDK_COMMIT,
            "generator": "generate.py",
            "signerLabel": SIGNER_LABEL,
            "signerAddress": wallet.address,
        },
        "vectors": {},
    }
    for name, action in actions().items():
        vault = "0x1719884eb866cb12b2287399b15f7db5e7d775ea" if name == "limitOrder" else None
        action_bytes = msgpack.packb(action)
        digest = action_hash(action, vault, NONCE, EXPIRES_AFTER)
        vector = {
            "actionBytesLength": len(action_bytes),
            "actionBytesKeccak256": to_hex(keccak(action_bytes)),
            "actionHash": to_hex(digest),
            "vaultAddress": vault,
            "nonce": NONCE,
            "expiresAfter": EXPIRES_AFTER,
            "networks": {},
        }
        for network, is_mainnet in (("testnet", False), ("mainnet", True)):
            typed = l1_payload(construct_phantom_agent(digest, is_mainnet))
            message = encode_typed_data(full_message=typed)
            signed = wallet.sign_message(message)
            vector["networks"][network] = {
                "source": "a" if is_mainnet else "b",
                "typedDataHash": to_hex(signed.message_hash),
                "signatureKeccak256": to_hex(keccak(signed.signature)),
                "recoveredAddress": Account.recover_message(message, signature=signed.signature),
            }
        result["vectors"][name] = vector

    approval = {
        "type": "approveAgent",
        "agentAddress": agent.address,
        "agentName": "ht-0123456789abc valid_until 1727592000000",
        "nonce": NONCE,
    }
    approval_types = [
        {"name": "hyperliquidChain", "type": "string"},
        {"name": "agentAddress", "type": "address"},
        {"name": "agentName", "type": "string"},
        {"name": "nonce", "type": "uint64"},
    ]
    result["approveAgent"] = {}
    for network, is_mainnet in (("testnet", False), ("mainnet", True)):
        action = approval.copy()
        signature = sign_agent(wallet, action, is_mainnet)
        typed = user_signed_payload(
            "HyperliquidTransaction:ApproveAgent", approval_types, action
        )
        message = encode_typed_data(full_message=typed)
        raw_signature = (
            int(signature["r"], 16).to_bytes(32, "big")
            + int(signature["s"], 16).to_bytes(32, "big")
            + bytes([signature["v"]])
        )
        result["approveAgent"][network] = {
            "hyperliquidChain": action["hyperliquidChain"],
            "signatureChainId": action["signatureChainId"],
            "typedDataHash": to_hex(keccak(b"\x19" + message.version + message.header + message.body)),
            "signatureKeccak256": to_hex(keccak(raw_signature)),
            "recoveredAddress": Account.recover_message(
                message, vrs=[signature["v"], signature["r"], signature["s"]]
            ),
            "agentAddress": agent.address,
            "agentName": approval["agentName"],
            "nonce": NONCE,
        }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
