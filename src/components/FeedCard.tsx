import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { avatarUrl, postImageUrl, timeAgo, type FeedPost } from '../lib/feed-api';
import { radius, space, useTheme } from '../theme';
import { CATEGORY_ICONS, CATEGORY_LABELS_ONE, MEAL_LABELS } from '../types';
import { Avatar } from './Avatar';
import { Meta, RecipeImage } from './ui';

type Props = {
  post: FeedPost;
  saved: boolean;
  onOpen: () => void;
  onLike: () => void;
  onSave: () => void;
};

/** One chef's recipe in the feed: chef, photo, title, like and save. */
export function FeedCard({ post, saved, onOpen, onLike, onSave }: Props) {
  const c = useTheme();
  const meta =
    post.category !== 'food' ? CATEGORY_LABELS_ONE[post.category] : post.mealTypes.map((m) => MEAL_LABELS[m]).join(' • ');
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.chef}>
        <Avatar uri={avatarUrl(post)} size={36} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.chefName, { color: c.text }]} numberOfLines={1}>
            {post.author.name}
          </Text>
          <Text style={{ color: c.muted, fontSize: 12 }}>{timeAgo(post.createdAt)}</Text>
        </View>
        {post.mine ? <Text style={[styles.mine, { color: c.accent, backgroundColor: c.accentSoft }]}>وصفتك</Text> : null}
      </View>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={post.title}>
        <RecipeImage uri={postImageUrl(post)} height={220} rounded={false} icon={CATEGORY_ICONS[post.category]} />
        <View style={styles.body}>
          <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
            {post.title}
          </Text>
          <View style={styles.metaRow}>
            {meta ? <Meta icon={post.category === 'food' ? 'time-outline' : CATEGORY_ICONS[post.category]} label={meta} /> : null}
            {post.prepMinutes ? <Meta icon="hourglass-outline" label={`${post.prepMinutes} دقيقة`} /> : null}
          </View>
        </View>
      </Pressable>
      <View style={[styles.actions, { borderTopColor: c.border }]}>
        <Pressable onPress={onLike} style={styles.action} accessibilityRole="button" accessibilityLabel={post.likedByMe ? 'شيل الإعجاب' : 'أعجبني'}>
          <Ionicons name={post.likedByMe ? 'heart' : 'heart-outline'} size={22} color={post.likedByMe ? c.primary : c.muted} />
          <Text style={[styles.actionText, { color: post.likedByMe ? c.primary : c.muted }]}>{post.likes || ''} أعجبني</Text>
        </Pressable>
        {!post.mine ? (
          <Pressable onPress={onSave} disabled={saved} style={styles.action} accessibilityRole="button">
            <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={21} color={saved ? c.primary : c.muted} />
            <Text style={[styles.actionText, { color: saved ? c.primary : c.muted }]}>{saved ? 'في وصفاتك' : 'احفظها'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  chef: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md },
  chefName: { fontSize: 15, fontWeight: '800' },
  mine: { fontSize: 12, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' },
  body: { padding: space.md, gap: 6 },
  title: { fontSize: 18, fontWeight: '900' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  actions: { flexDirection: 'row', borderTopWidth: 1 },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: space.md },
  actionText: { fontSize: 14, fontWeight: '700' },
});
