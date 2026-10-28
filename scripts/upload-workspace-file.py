#!/usr/bin/env python3
"""Stream a workspace file using a create_file_upload ticket; never print the token."""
import argparse
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file', type=Path)
    parser.add_argument('--ticket', default='-', help='Ticket JSON file, or - to read JSON from stdin')
    args = parser.parse_args()
    try:
        ticket = json.load(sys.stdin) if args.ticket == '-' else json.loads(Path(args.ticket).read_text())
        origin = json.loads((Path(__file__).resolve().parent.parent / 'installation.json').read_text())['publicOrigin']
        if ticket.get('uploadUrl') != origin + '/file-transfers/upload':
            raise ValueError('Ticket URL does not match this installation.')
        token = ticket.get('uploadToken', '')
        if not re.fullmatch(r'[a-f0-9]{64}', token):
            raise ValueError('Invalid upload token.')
        size = args.file.stat().st_size
        if size != ticket.get('size') or not 0 <= size <= 25 * 1024 * 1024:
            raise ValueError('File size does not match ticket or exceeds 25 MiB.')
        opener = urllib.request.build_opener(NoRedirect())
        with args.file.open('rb') as source:
            request = urllib.request.Request(ticket['uploadUrl'], data=source, method='POST', headers={
                'Authorization': 'Bearer ' + token, 'Content-Length': str(size),
                'Content-Type': 'application/octet-stream', 'Accept': 'application/json',
            })
            with opener.open(request, timeout=300) as response:
                result = json.loads(response.read(65536))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except urllib.error.HTTPError as error:
        print(f'Upload failed (HTTP {error.code}). Check the dashboard file list before retrying.', file=sys.stderr)
    except (OSError, ValueError, KeyError, TypeError):
        print('Upload failed. Check the local file, ticket, connection and dashboard file list before retrying.', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
