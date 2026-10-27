import { StyleSheet, Text, View } from 'react-native';
import { radius, space, useTheme } from '../theme';
import { SectionTitle } from './ui';

/** Ingredients + numbered steps, shared by saved and internet recipes. */
export function RecipeBody({
  ingredients,
  steps,
  notes,
  ltr,
}: {
  ingredients: string[];
  steps: string[];
  notes?: string;
  /** Lay out list items left-to-right (English recipes from the internet). */
  ltr?: boolean;
}) {
  const c = useTheme();
  const itemDir = ltr ? ({ direction: 'ltr' } as const) : null;
  return (
    <View style={{ gap: space.xl }}>
      {ingredients.length > 0 && (
        <View style={{ gap: space.sm }}>
          <SectionTitle>المكونات</SectionTitle>
          {ingredients.map((item, i) => (
            <View key={i} style={[styles.row, itemDir]}>
              <View style={[styles.dot, { backgroundColor: c.primary }]} />
              <Text style={[styles.text, { color: c.text }]}>{item}</Text>
            </View>
          ))}
        </View>
      )}
      {steps.length > 0 && (
        <View style={{ gap: space.md }}>
          <SectionTitle>طريقة التحضير</SectionTitle>
          {steps.map((step, i) => (
            <View key={i} style={[styles.row, itemDir]}>
              <View style={[styles.num, { backgroundColor: c.primarySoft }]}>
                <Text style={[styles.numText, { color: c.primary }]}>{i + 1}</Text>
              </View>
              <Text style={[styles.text, { color: c.text }]}>{step}</Text>
            </View>
          ))}
        </View>
      )}
      {notes ? (
        <View style={[styles.notes, { backgroundColor: c.cardAlt }]}>
          <SectionTitle>ملاحظات</SectionTitle>
          <Text style={[styles.text, { color: c.text }]}>{notes}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 9 },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  numText: { fontWeight: '800', fontSize: 14 },
  text: { flex: 1, fontSize: 16, lineHeight: 26 },
  notes: { borderRadius: radius.md, padding: space.lg, gap: space.sm },
});
