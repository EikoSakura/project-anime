import { attributesField, hotbarField, luckField, pointsField, rankField, textField } from "./fields.mjs";

const { BooleanField } = foundry.data.fields;

export default class AdversaryData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      desire: textField(),
      fear: textField(),
      grade: rankField(1),
      attributes: attributesField(),
      hearts: pointsField(),
      energy: pointsField(),
      rival: new BooleanField(),
      luck: luckField(),
      hotbar: hotbarField()
    };
  }
}
