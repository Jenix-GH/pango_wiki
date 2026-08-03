#!/usr/bin/env python3
"""按微信小程序 wx.uploadFile 的请求格式测试语音识别接口。"""

import argparse
import json
import mimetypes
import sys
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_URL = 'https://aiapp.pangomicro.com/dbServ/wx/transcribe'


def build_multipart(audio_path: Path) -> tuple[bytes, str]:
    boundary = '----PangoWikiTest' + uuid.uuid4().hex
    mime_type = mimetypes.guess_type(audio_path.name)[0] or 'audio/aac'
    prefix = (
        f'--{boundary}\r\n'
        f'Content-Disposition: form-data; name="audio"; filename="{audio_path.name}"\r\n'
        f'Content-Type: {mime_type}\r\n\r\n'
    ).encode('utf-8')
    suffix = f'\r\n--{boundary}--\r\n'.encode('ascii')
    return prefix + audio_path.read_bytes() + suffix, boundary


def main() -> int:
    parser = argparse.ArgumentParser(
        description='上传AAC等音频到 /wx/transcribe，并打印完整响应'
    )
    parser.add_argument('audio', type=Path, help='音频文件路径，例如 test.aac')
    parser.add_argument('--url', default=DEFAULT_URL, help='接口完整地址')
    parser.add_argument('--timeout', type=float, default=90, help='超时秒数，默认90')
    args = parser.parse_args()

    if not args.audio.is_file():
        print(f'错误：找不到音频文件：{args.audio}', file=sys.stderr)
        return 2

    body, boundary = build_multipart(args.audio)
    request = Request(
        args.url,
        data=body,
        method='POST',
        headers={
            'Content-Type': f'multipart/form-data; boundary={boundary}',
            'Content-Length': str(len(body)),
            'User-Agent': 'PangoWiki-ASR-Test/1.0',
        },
    )

    print(f'接口：{args.url}')
    print(f'文件：{args.audio} ({args.audio.stat().st_size} bytes)')
    started_at = time.monotonic()
    try:
        with urlopen(request, timeout=args.timeout) as response:
            status = response.status
            raw = response.read().decode('utf-8', errors='replace')
    except HTTPError as exc:
        status = exc.code
        raw = exc.read().decode('utf-8', errors='replace')
    except (URLError, TimeoutError) as exc:
        print(f'请求失败：{exc}', file=sys.stderr)
        return 3

    elapsed = time.monotonic() - started_at
    print(f'HTTP状态：{status}')
    print(f'耗时：{elapsed:.2f} 秒')
    try:
        payload = json.loads(raw)
        print('响应：')
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    except json.JSONDecodeError:
        print(f'非JSON响应：\n{raw}')
        return 4

    if status == 200 and payload.get('code') == 2000:
        text = payload.get('data', {}).get('text', '')
        print(f'识别成功：{text}')
        return 0

    print('识别失败，请把上面的完整响应和服务器对应时间的日志发给我。', file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
