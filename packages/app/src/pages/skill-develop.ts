export type SkillDevelopItem = {
  id: string
  title: string
  copy: string
  layer?: string
  tags?: readonly string[]
  provider?: string
}

export type SkillDevelopHandoff = {
  prompt: string
  skill: {
    name: string
    title: string
  }
}

export function skillDevelopPrompt(item: SkillDevelopItem) {
  return skillDevelopHandoff(item).prompt
}

export function skillDevelopHandoff(item: SkillDevelopItem): SkillDevelopHandoff {
  return {
    prompt: `请基于 OneSkills 技能「${item.title}」进行科研开发。`,
    skill: {
      name: item.id,
      title: item.title,
    },
  }
}
