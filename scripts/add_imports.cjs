const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');
const imports = `import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
`;
content = content.replace(
  'import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "../components/ui/accordion";',
  'import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "../components/ui/accordion";\n' + imports
);
fs.writeFileSync('src/App.tsx', content);
