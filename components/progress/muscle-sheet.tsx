import BodyFigure from 'react-native-body-highlighter';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import type { BodyRegion } from '@/lib/body-map';
import { muscleFacts } from '@/lib/scoreboard';
import { C, FONT, TABULAR } from '@/lib/theme';
import type { BoardLift } from '@/lib/types';

// The muscle popup — the figure's new home (user decision 2026-09-02).
//
// Two full-width stacked bodies used to sit on the Progress page and cost most of a screen
// to say "the back of you is grey". The twelve chips on the coverage row say that in four
// lines, and the DRAWING is what a person wants once they have picked a muscle out of them:
// where it is, what it got this week, and what fed it.
//
// So the figure moved in here, zoomed on the one region the chip named, and it arrives with
// the facts the old tap-detail could only fit into a single sentence: the band, when the
// muscle was last trained and by what, and every exercise on the board that feeds it.

/**
 * Which side of the body each region reads best on. The package draws deltoids, forearms
 * and calves on both; everything else has one honest side, and showing a chest from behind
 * is a picture of a back.
 */
const SIDE: Record<string, 'front' | 'back'> = {
  chest: 'front',
  shoulders: 'front',
  biceps: 'front',
  triceps: 'back',
  forearms: 'front',
  core: 'front',
  lats: 'back',
  upper_back: 'back',
  glutes: 'back',
  quads: 'front',
  hamstrings: 'back',
  calves: 'back',
};

/** Bigger than the coverage map's own figure: this one is about a single muscle. */
const FIGURE_SCALE = 1.7;

export function MuscleSheet({
  region,
  lifts,
  onClose,
}: {
  /** Null keeps the modal unmounted — the sheet exists only while a chip is chosen. */
  region: BodyRegion | null;
  lifts: readonly BoardLift[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!region) return null;

  const facts = muscleFacts(region, lifts);
  const side = SIDE[region.key] ?? 'front';
  const highlighted = region.slugs.map((slug) => ({
    slug,
    color: region.color,
    styles: { fill: region.color, stroke: C.accent, strokeWidth: 1.2 },
  }));

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
      testID="muscle-sheet">
      {/* The page below, dimmed. A tap on it is the way out, the same as anywhere else in
          this app that opens something over what you were reading. */}
      <Pressable
        testID="muscle-sheet-backdrop"
        accessibilityLabel="Close"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
        <Pressable
          // Swallows the tap so pressing the sheet itself does not close it.
          onPress={() => {}}
          style={{
            backgroundColor: C.card,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingHorizontal: 20,
            paddingTop: 18,
            paddingBottom: insets.bottom + 22,
            maxHeight: '86%',
          }}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Eyebrow testID="muscle-sheet-eyebrow">{`Coverage · ${facts.label}`}</Eyebrow>
            <Disp size={34} testID="muscle-sheet-headline" style={{ marginTop: 6 }}>
              {facts.headline}
            </Disp>
            <Sub testID="muscle-sheet-band" style={{ marginTop: 3, color: region.overdue ? C.accent : C.mute }}>
              {facts.band}
            </Sub>

            <View testID="muscle-sheet-figure" style={{ alignItems: 'center', marginTop: 14 }}>
              <BodyFigure
                side={side}
                gender="male"
                scale={FIGURE_SCALE}
                data={highlighted}
                defaultFill={C.track}
                defaultStroke={C.line}
                defaultStrokeWidth={0.5}
                border="none"
                hiddenParts={['hair', 'head', 'hands', 'feet']}
              />
              <Sub style={{ marginTop: 4, fontSize: 10 }}>{side === 'front' ? 'Front' : 'Back'}</Sub>
            </View>

            <View testID="muscle-sheet-facts" style={{ marginTop: 16, gap: 9 }}>
              {facts.facts.map((fact) => (
                <View key={fact.label} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <Eyebrow style={{ width: 92, paddingTop: 2 }}>{fact.label}</Eyebrow>
                  <Body
                    testID={`muscle-fact-${fact.label.toLowerCase().replace(/\s+/g, '-')}`}
                    style={[{ flex: 1, fontFamily: FONT.regular, lineHeight: 20 }, TABULAR]}>
                    {fact.value}
                  </Body>
                </View>
              ))}
            </View>

            <Pressable
              testID="muscle-sheet-close"
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={{ marginTop: 18, alignSelf: 'flex-start', paddingVertical: 8 }}>
              <Sub style={{ color: C.mute }}>Close</Sub>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
