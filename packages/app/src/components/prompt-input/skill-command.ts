export type SkillChip = {
  name: string
  title: string
}

export function resolveSkillCommand(input: {
  text: string
  skills: readonly SkillChip[]
  commands: readonly { name: string }[]
}) {
  const skill = input.skills[0]
  if (!skill) return
  if (!input.commands.some((item) => item.name === skill.name)) return
  return {
    command: skill.name,
    arguments: input.text,
  }
}
