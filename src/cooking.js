const lines = value => value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

export function parseCooking(ingredients, steps) {
  return {
    ingredients: lines(ingredients).map(line => {
      const parts = line.split(/[|｜]/).map(part => part.trim());
      if (parts.length === 2 || parts.length === 3) {
        const [name, amount, unit = ''] = parts;
        if (name && amount) return { name, amount, unit };
      }
      return { name: line, amount: '', unit: '' };
    }),
    steps: lines(steps)
  };
}

export function cookingText(cooking) {
  return {
    ingredientsText: (cooking?.ingredients ?? []).map(({ name, amount, unit }) => amount ? `${name} | ${amount}${unit ? ` | ${unit}` : ''}` : name).join('\n'),
    stepsText: (cooking?.steps ?? []).join('\n')
  };
}

export function extractPastedRecipe(text) {
  const result = { ingredientsText: '', stepsText: '' };
  let section;
  for (const line of lines(text)) {
    const heading = line.match(/^(食材|材料|用料|配料|做法|步骤|制作步骤|ingredients|instructions|directions)\s*(?:[:：]\s*(.*)|$)/i);
    if (heading) {
      section = /食材|材料|用料|配料|ingredients/i.test(heading[1]) ? 'ingredientsText' : 'stepsText';
      if (heading[2]) result[section] += `${heading[2]}\n`;
    } else if (section) {
      result[section] += `${line}\n`;
    }
  }
  return { ingredientsText: result.ingredientsText.trim(), stepsText: result.stepsText.trim() };
}
