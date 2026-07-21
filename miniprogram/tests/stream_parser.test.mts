import assert from "node:assert/strict"
import { splitStreamFrames } from "../miniprogram/pages/main/stream"

{
  const result = splitStreamFrames('{"code":0,"data":{"status":"正在查阅资料..."}}\n{"code":0,"data":true}\n')
  assert.deepEqual(result.frames, [
    '{"code":0,"data":{"status":"正在查阅资料..."}}',
    '{"code":0,"data":true}',
  ])
  assert.equal(result.rest, "")
}

{
  const result = splitStreamFrames('data: {"code":0,"data":{"answer":"A"}}\n\n{"code":0')
  assert.deepEqual(result.frames, ['{"code":0,"data":{"answer":"A"}}'])
  assert.equal(result.rest, '{"code":0')
}

{
  const result = splitStreamFrames('{"code":0,"data":{"answer":"B"}}\r\n')
  assert.deepEqual(result.frames, ['{"code":0,"data":{"answer":"B"}}'])
  assert.equal(result.rest, "")
}
