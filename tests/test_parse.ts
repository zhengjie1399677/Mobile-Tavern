import { parseMvuMessage } from "../src/utils/tavernHelper";

const oldData = {
  stat_data: {
    "十二时辰": "子时",
    "天霁": "晴"
  }
};

const message = `
[mvu_update]
_.set('stat_data.十二时辰', '午时');
_.set('stat_data.天霁', '阴');
`;

const result = parseMvuMessage(message, oldData);
console.log("Result:", JSON.stringify(result, null, 2));
