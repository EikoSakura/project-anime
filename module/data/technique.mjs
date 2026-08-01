import { rankField, rulingsField } from "./fields.mjs";

const { HTMLField, StringField } = foundry.data.fields;

export default class TechniqueData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      rank: rankField(),
      kind: new StringField({ required: true, initial: "Activated", choices: ["Activated", "Triggered"] }),
      text: new HTMLField({ required: true, initial: "" }),
      rulings: rulingsField()
    };
  }
}
