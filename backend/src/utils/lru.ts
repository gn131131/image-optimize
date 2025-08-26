export interface LRUOptions {
    max: number;
}

interface NodeEntry<V> {
    key: string;
    value: V;
    prev?: NodeEntry<V>;
    next?: NodeEntry<V>;
}

export class LRUCache<V> {
    private map = new Map<string, NodeEntry<V>>();
    private head?: NodeEntry<V>;
    private tail?: NodeEntry<V>;
    constructor(private opts: LRUOptions) {}
    get size() {
        return this.map.size;
    }
    get(key: string): V | undefined {
        const node = this.map.get(key);
        if (!node) return undefined;
        this.touch(node);
        return node.value;
    }
    set(key: string, value: V) {
        let node = this.map.get(key);
        if (node) {
            node.value = value;
            this.touch(node);
            return;
        }
        node = { key, value };
        this.map.set(key, node);
        this.addToFront(node);
        if (this.map.size > this.opts.max) this.evict();
    }
    private addToFront(node: NodeEntry<V>) {
        node.prev = undefined;
        node.next = this.head;
        if (this.head) this.head.prev = node;
        this.head = node;
        if (!this.tail) this.tail = node;
    }
    private touch(node: NodeEntry<V>) {
        if (node === this.head) return;
        // detach
        if (node.prev) node.prev.next = node.next;
        if (node.next) node.next.prev = node.prev;
        if (node === this.tail) this.tail = node.prev;
        this.addToFront(node);
    }
    private evict() {
        if (!this.tail) return;
        const k = this.tail.key;
        if (this.tail.prev) this.tail.prev.next = undefined;
        this.tail = this.tail.prev;
        this.map.delete(k);
        if (!this.tail) this.head = undefined;
    }
}
