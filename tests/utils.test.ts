import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clientIdAlreadyApproved,
  parseRedirectApproval,
  renderApprovalDialog,
} from '../src/utils.ts'

const SECRET = 'test-secret-that-is-long-enough'

function requestWithCookie(cookie?: string): Request {
  const headers = cookie ? { Cookie: cookie } : undefined
  return new Request('https://example.com/authorize', { headers })
}

function extractCookie(setCookie: string): string {
  return setCookie.split(';', 1)[0]
}

test('approval is false when no cookie exists', async () => {
  assert.equal(
    await clientIdAlreadyApproved(requestWithCookie(), 'client-1', SECRET),
    false
  )
})

test('approval cookie can be created and then verified', async () => {
  const request = new Request('https://example.com/authorize', {
    method: 'POST',
    body: new URLSearchParams({
      action: 'approve',
      state: btoa(JSON.stringify({
        oauthReqInfo: { clientId: 'client-1', scope: [] },
      })),
    }),
  })

  const result = await parseRedirectApproval(request, SECRET)
  const cookie = extractCookie(result.headers['Set-Cookie'])

  assert.match(cookie, /^github_mcp_approved_clients=/)
  assert.equal(
    await clientIdAlreadyApproved(requestWithCookie(cookie), 'client-1', SECRET),
    true
  )
})

test('approval cookie merges previously approved clients', async () => {
  const first = new Request('https://example.com/authorize', {
    method: 'POST',
    body: new URLSearchParams({
      action: 'approve',
      state: btoa(JSON.stringify({
        oauthReqInfo: { clientId: 'client-1', scope: [] },
      })),
    }),
  })
  const firstResult = await parseRedirectApproval(first, SECRET)
  const firstCookie = extractCookie(firstResult.headers['Set-Cookie'])

  const second = new Request('https://example.com/authorize', {
    method: 'POST',
    headers: { Cookie: firstCookie },
    body: new URLSearchParams({
      action: 'approve',
      state: btoa(JSON.stringify({
        oauthReqInfo: { clientId: 'client-2', scope: [] },
      })),
    }),
  })
  const secondResult = await parseRedirectApproval(second, SECRET)
  const secondCookie = extractCookie(secondResult.headers['Set-Cookie'])

  assert.equal(
    await clientIdAlreadyApproved(requestWithCookie(secondCookie), 'client-1', SECRET),
    true
  )
  assert.equal(
    await clientIdAlreadyApproved(requestWithCookie(secondCookie), 'client-2', SECRET),
    true
  )
})

test('tampered approval cookies are rejected', async () => {
  const valid = await parseRedirectApproval(
    new Request('https://example.com/authorize', {
      method: 'POST',
      body: new URLSearchParams({
        action: 'approve',
        state: btoa(JSON.stringify({
          oauthReqInfo: { clientId: 'client-1', scope: [] },
        })),
      }),
    }),
    SECRET
  )
  const cookie = extractCookie(valid.headers['Set-Cookie'])
  const tampered = cookie.replace(/.$/, 'x')

  assert.equal(
    await clientIdAlreadyApproved(requestWithCookie(tampered), 'client-1', SECRET),
    false
  )
})

test('malformed approval cookies are rejected', async () => {
  assert.equal(
    await clientIdAlreadyApproved(
      requestWithCookie('github_mcp_approved_clients=%'), 'client-1', SECRET
    ),
    false
  )
})

test('approval dialog escapes untrusted client/server text', () => {
  const response = renderApprovalDialog(
    new Request('https://example.com/authorize'),
    {
      client: { clientId: '<client>', clientName: '<script>alert(1)</script>' } as never,
      server: {
        name: '<Server>',
        description: '<img src=x onerror=alert(1)>',
      },
      state: {
        oauthReqInfo: { clientId: 'client-1', scope: [] },
      },
    }
  )

  return response.text().then((html) => {
    assert.match(html, /&lt;Server&gt;/)
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
    assert.doesNotMatch(html, /<img src=x/)
  })
})
