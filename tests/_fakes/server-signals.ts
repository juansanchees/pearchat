// Sobe o server.ts DE VERDADE e repassa "SIGTERM"/"SIGINT" lidos da entrada padrão como sinais do próprio processo.
// No Windows, process.kill(pid, 'SIGTERM') encerra à força sem rodar os tratadores; assim o teste exercita o caminho
// real do desligamento gracioso em qualquer sistema. Uso só em teste (tests/engine/process-lifecycle.test.ts).
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  if (chunk.includes('SIGTERM')) process.emit('SIGTERM')
  else if (chunk.includes('SIGINT')) process.emit('SIGINT')
})
void import('../../server')
