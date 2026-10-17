/**
 * Vue owns the component and its visitor state while a child effectScope owns
 * the installed composable. Stop/restart changes that native scope, not a
 * replacement session implementation or an application fetch scheduler.
 */
import {
  computed,
  defineComponent,
  effectScope,
  h,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watchEffect,
} from 'vue';
import { useLivePreviewDocument } from 'payload-live-preview/vue';
import { connection, initialData, installControls, ledger } from './ledger.mjs';

export const App = defineComponent({
  props: ['admin', 'document', 'initialData'],
  setup(props) {
    const count = ref(0);
    const generation = ref(1);
    const stopped = ref(false);
    let scope;
    let target;
    let removeControls;
    const start = () => {
      scope = effectScope();
      const result = scope.run(() =>
        useLivePreviewDocument({
          initialData: props.initialData ?? initialData(props.document),
          ...connection(props.admin, target),
        }),
      );
      if (!result) throw new Error('The native effect scope was inactive');
      if (typeof window !== 'undefined') ledger().scopeStarts += 1;
      return result;
    };
    const session = shallowRef(start());
    const stop = () => {
      if (scope) {
        scope.stop();
        scope = undefined;
        ledger().scopeStops += 1;
      }
      stopped.value = true;
    };
    const restart = () => {
      stop();
      session.value = start();
      generation.value += 1;
      stopped.value = false;
    };
    const data = computed(() => session.value.data.value);
    watchEffect(() => {
      const current = session.value;
      if (typeof window !== 'undefined') {
        // A stopped or replaced native effectScope exposes only this public
        // composable snapshot; no internal session is substituted or inspected.
        ledger().activeSession = {
          observation: 'native-vue-public-snapshot',
          nativeConsumer: props.document + ':' + generation.value,
          document: props.document,
          receiver: target === undefined ? 'primary' : 'secondary',
          revision: current.revision.value,
          status: current.status.value,
          isLoading: current.isLoading.value,
          title: String(current.data.value.title ?? '').slice(0, 2048),
          error: current.error.value ? String(current.error.value.message).slice(0, 2048) : null,
        };
        if (
          current.revision.value > 0 &&
          !current.isLoading.value &&
          current.status.value === 'live'
        ) {
          ledger().commits.push({
            marker: current.data.value.title,
            revision: current.revision.value,
            document: props.document,
            target: ledger().target,
          });
        }
      }
    });
    onMounted(() => {
      ledger().ready = true;
      ledger().document = props.document;
      removeControls = installControls(props.admin, (window) => {
        target = window;
        restart();
      });
    });
    onUnmounted(() => {
      removeControls?.();
      stop();
    });
    return () =>
      h('div', null, [
        h('output', { 'data-testid': 'scope' }, stopped.value ? 'stopped' : 'active'),
        h('output', { 'data-testid': 'generation' }, String(generation.value)),
        h('button', { 'data-testid': 'stop-preview', onClick: stop }, 'Stop effect scope'),
        h(
          'button',
          { 'data-testid': 'restart-preview', onClick: restart },
          'Start a new effect scope',
        ),
        h('article', null, [
          h('h1', { 'data-testid': 'title' }, data.value.title),
          h('p', { 'data-testid': 'subtitle' }, data.value.subtitle),
          h('p', { 'data-testid': 'status' }, session.value.status.value),
          h('p', { 'data-testid': 'revision' }, String(session.value.revision.value)),
          h(
            'p',
            { 'data-testid': 'author' },
            typeof data.value.author === 'object' && data.value.author !== null
              ? (data.value.author.email ?? data.value.author.name ?? '')
              : '',
          ),
          h(
            'button',
            {
              'data-testid': 'counter',
              onClick: () => {
                count.value += 1;
              },
            },
            String(count.value),
          ),
          h('input', { 'data-testid': 'visitor', value: 'Visitor value' }),
          session.value.error.value
            ? h('p', { 'data-testid': 'error' }, session.value.error.value.message)
            : null,
        ]),
      ]);
  },
});
