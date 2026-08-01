import { attributesField, luckField, pointsField, rankField, textField } from "./fields.mjs";

const { ArrayField, BooleanField, NumberField, SchemaField } = foundry.data.fields;

function boxesField(n) {
  return new ArrayField(new BooleanField(), { required: true, initial: () => Array(n).fill(false) });
}

export default class CharacterData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      player: textField(),
      age: textField(),
      gender: textField(),
      pronouns: textField(),
      grade: rankField(1),
      attributes: attributesField(),
      hearts: pointsField(),
      energy: pointsField(),
      luck: luckField(),
      bonds: new ArrayField(
        new SchemaField({
          name: textField(),
          number: new NumberField({ required: true, nullable: false, integer: true, min: 1, max: 6, initial: 1 }),
          text: textField()
        })
      ),
      advancements: new SchemaField({
        unspent: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        standard: new SchemaField({
          newTrait: boxesField(3),
          rankTrait: boxesField(2),
          newTech: boxesField(3),
          rankTech: boxesField(2),
          newHeart: boxesField(1),
          newEnergy: boxesField(1)
        }),
        special: new SchemaField({
          luck: boxesField(3),
          grade: boxesField(4),
          attribute: boxesField(6)
        })
      }),
      personality: textField(),
      history: textField(),
      notes: textField()
    };
  }
}
