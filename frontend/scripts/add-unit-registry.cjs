const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '..', 'src', 'App.tsx');
let content = fs.readFileSync(appPath, 'utf-8');

// Add Wallet to imports
content = content.replace(
  'DollarSign,\n} from "lucide-react";',
  'DollarSign,\n  Wallet,\n} from "lucide-react";'
);

// Add UnitRegistry import
content = content.replace(
  'import { FundPrices } from "./components/fund-price/FundPrices";',
  'import { FundPrices } from "./components/fund-price/FundPrices";\nimport { UnitRegistry } from "./components/unit-registry/UnitRegistry";'
);

// Add unit-registry module
content = content.replace(
  `    {
      id: "goal-transactions",`,
  `    {
      id: "unit-registry",
      name: "Unit Registry",
      icon: Wallet,
      description: "Client portfolio positions and values",
    },
    {
      id: "goal-transactions",`
);

// Add unit-registry case
content = content.replace(
  `      case "goal-transactions":
        return <GoalTransactions />;`,
  `      case "unit-registry":
        return <UnitRegistry />;
      case "goal-transactions":
        return <GoalTransactions />;`
);

fs.writeFileSync(appPath, content);
console.log('✓ Unit Registry added to App.tsx');
