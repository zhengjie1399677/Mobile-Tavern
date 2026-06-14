const fs = require('fs');
const path = require('path');

try {
  const filePath = 'C:\\Users\\20573\\Downloads\\夏瑾 双鱼座 Beta 0.40.json';
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  const preset = JSON.parse(content);
  
  console.log('================== PRESET SUMMARY ==================');
  console.log('Preset keys:', Object.keys(preset));
  
  // Print standard SillyTavern preset info
  console.log('System Prompt length:', preset.system_prompt?.length || preset.system_prompt_markdown?.length || 0);
  console.log('Jailbreak Prompt length:', preset.jailbreak_prompt?.length || preset.jailbreak_prompt_markdown?.length || 0);
  console.log('Story String:', preset.story_string || preset.story_string_markdown || 'None');
  
  if (preset.name) console.log('Preset Name:', preset.name);
  
  // Print instruct settings if present
  if (preset.instruct_template || preset.temp_id) {
    console.log('Instruct Template Config present!');
    console.log('  User prefix:', preset.user_prefix);
    console.log('  Assistant prefix:', preset.assistant_prefix);
    console.log('  System prefix:', preset.system_prefix);
  }
  
  // Print prompts details
  if (preset.prompts && Array.isArray(preset.prompts)) {
    console.log('Total prompts count:', preset.prompts.length);
    const summaryList = preset.prompts.map((p, idx) => ({
      idx,
      name: p.name,
      role: p.role,
      enabled: p.enabled,
      system_prompt: p.system_prompt,
      marker: p.marker,
      contentLen: p.content?.length || 0,
      injection_depth: p.injection_depth,
      injection_position: p.injection_position
    }));
    
    // Write full prompts summary to a file for review
    const logPath = path.join(__dirname, 'all_prompts_info.json');
    fs.writeFileSync(logPath, JSON.stringify(summaryList, null, 2), 'utf8');
    console.log(`All prompts attributes successfully written to: ${logPath}`);

    // Print first 40 names
    console.log('First 40 prompts names:');
    summaryList.slice(0, 40).forEach(p => {
      console.log(`  [${p.idx}] name="${p.name}", enabled=${p.enabled}, system=${p.system_prompt}, marker=${p.marker}, len=${p.contentLen}`);
    });
  }
  
  // Print extensions details
  if (preset.extensions) {
    console.log('Extensions keys in preset:', Object.keys(preset.extensions));
    for (const [key, val] of Object.entries(preset.extensions)) {
      if (val && typeof val === 'object') {
        if (Array.isArray(val)) {
          console.log(`  Extension "${key}" (Array), length: ${val.length}`);
        } else {
          console.log(`  Extension "${key}" (Object), keys:`, Object.keys(val));
          if (key === 'SPreset') {
            console.log(`    SPreset details:`, JSON.stringify(val, null, 2));
          }
          if (key === 'tavern_helper') {
            console.log(`    tavern_helper details (first 1000 chars):`, JSON.stringify(val).slice(0, 1000));
          }
        }
      } else {
        console.log(`  Extension "${key}":`, val);
      }
    }
  }

  // Check prompt_order
  if (preset.prompt_order) {
    console.log('Prompt Order:', preset.prompt_order);
  }

} catch (e) {
  console.error('Failed to parse preset JSON:', e);
}
