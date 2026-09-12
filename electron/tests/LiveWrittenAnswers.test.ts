import test from "node:test"
import assert from "node:assert/strict"
import { LiveWrittenAnswers } from "../../src/components/VoiceAssistant/LiveWrittenAnswers"

const delta = (sequence: number, text: string, delegationId = "d1", item = "m1") => ({
  type: "response.event", delegation_id: delegationId,
  event: { type: "response.output_text.delta", sequence_number: sequence, item_id: item, content_index: 0, delta: text }
})

test("written code preserves indentation, repairs event order, and ignores replayed deltas", () => {
  const answers = new LiveWrittenAnswers()
  answers.append(delta(2, "    return value.copy()\n```"))
  answers.append(delta(1, "```python\ndef shallow(value):\n"))
  assert.equal(answers.append(delta(2, "    return value.copy()\n```")), false)
  assert.equal(answers.answers[0].text, "```python\ndef shallow(value):\n    return value.copy()\n```")
  const snapshot = answers.answers
  answers.append({ type: "response.event", delegation_id: "d1", event: { type: "response.completed", response: { output: [] } } })
  assert.equal(answers.answers[0].status, "complete")
  assert.equal(answers.answers[0].text, snapshot[0].text)
  assert.equal(snapshot[0].status, "streaming")
})

test("done text reconciles the complete answer without doubling the streamed prefix", () => {
  const answers = new LiveWrittenAnswers()
  answers.append(delta(1, "```python\nx ="))
  answers.append({ type: "response.event", delegation_id: "d1", event: {
    type: "response.output_text.done", item_id: "m1", content_index: 0, sequence_number: 2,
    text: "```python\nx = [1, 2]\n```"
  } })
  assert.equal(answers.answers[0].text, "```python\nx = [1, 2]\n```")
  assert.equal(answers.append(delta(3, "late text")), false)
})

test("concurrent written answers stay separate and cancellation preserves incomplete code", () => {
  const answers = new LiveWrittenAnswers()
  answers.append(delta(1, "original = [[1]]", "first"))
  answers.append(delta(1, "import copy", "second"))
  answers.append(delta(2, "\ndeep = copy.deepcopy(original)", "second"))
  answers.finish("complete", "first")
  answers.finish("incomplete")
  assert.deepEqual(answers.answers.map(answer => [answer.text, answer.status]), [
    ["original = [[1]]", "complete"], ["import copy\ndeep = copy.deepcopy(original)", "incomplete"]
  ])
})

test("only identified output text is exposed; reasoning and tools never become written answers", () => {
  const answers = new LiveWrittenAnswers()
  for (const type of ["response.reasoning_text.delta", "response.function_call_arguments.delta", "response.created"]) {
    assert.equal(answers.append({ ...delta(1, "private"), event: { ...delta(1, "private").event, type } }), false)
  }
  assert.equal(answers.append({ type: "response.output_text.delta", delta: "unwrapped" }), false)
  assert.equal(answers.append({ type: "response.event", delegation_id: "d1", event: { type: "response.output_text.delta", delta: "missing identity" } }), false)
  assert.deepEqual(answers.answers, [])
  assert.throws(() => answers.append(delta(1, "x".repeat(1000001))), /limit/)
})
