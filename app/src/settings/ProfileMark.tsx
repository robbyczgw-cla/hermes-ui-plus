// Connection marks: neutral letter monograms (services) or stroke icons (own server, demo) on one tile
// style. No emoji and no logos (trademarks): the letters only abbreviate the product name.
import { Text, View } from 'react-native';
import { Icon, type IconName } from '../chat/icons';
import { useTheme } from '../ui';
import type { ProfileKind } from './profiles';

export type MarkSpec = { text: string } | { icon: IconName };

const KIND_MARKS: Record<ProfileKind, MarkSpec> = {
  hermes: { text: 'He' },
  demo: { icon: 'play' },
};

/** mark of a profile */
export function markFor(kind: ProfileKind, _p?: { provider?: string; baseUrl?: string }): MarkSpec {
  return KIND_MARKS[kind];
}

export function ProfileMark({ mark, small }: { mark: MarkSpec; small?: boolean }) {
  const th = useTheme();
  const size = small ? 28 : 34;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 3.4,
        backgroundColor: th.colors.surfaceAlt,
        borderWidth: 1,
        borderColor: th.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {'text' in mark ? (
        <Text style={{ color: th.colors.text, fontSize: small ? 12 : 14, fontWeight: '600', letterSpacing: 0.2 }} allowFontScaling={false}>
          {mark.text}
        </Text>
      ) : (
        <Icon name={mark.icon} size={small ? 15 : 18} color={th.colors.text} strokeWidth={1.7} />
      )}
    </View>
  );
}
