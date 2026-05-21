// Types de la base Supabase — schéma `public`.
//
// Maintenu à la main d'après supabase/migrations/ (0001 → 0004).
// `supabase gen types` nécessite Docker (indispo ici) ; on édite donc ce
// fichier à la main à chaque migration qui change le schéma.
// Pour régénérer automatiquement depuis la base (nécessite Docker OU un
// SUPABASE_ACCESS_TOKEN) :
//   npx supabase gen types typescript --project-id htxqzktwuymzetbdqghx > lib/supabase/database.types.ts
// ou, avec Docker lancé :
//   npx supabase gen types typescript --db-url "<connection-string>" > lib/supabase/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      merchants: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          category: string | null;
          city: string | null;
          wilaya_code: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          category?: string | null;
          city?: string | null;
          wilaya_code?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          category?: string | null;
          city?: string | null;
          wilaya_code?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          merchant_id: string;
          customer_name: string;
          customer_phone: string;
          status: Database["public"]["Enums"]["order_status"];
          total_da: number;
          pickup_code: string;
          pickup_slot_at: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          customer_name: string;
          customer_phone: string;
          status?: Database["public"]["Enums"]["order_status"];
          total_da: number;
          pickup_code?: string;
          pickup_slot_at: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          customer_name?: string;
          customer_phone?: string;
          status?: Database["public"]["Enums"]["order_status"];
          total_da?: number;
          pickup_code?: string;
          pickup_slot_at?: string;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_merchant_id_fkey";
            columns: ["merchant_id"];
            referencedRelation: "merchants";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          id: string;
          merchant_id: string;
          name_fr: string;
          name_ar: string | null;
          description_fr: string | null;
          description_ar: string | null;
          price_da: number;
          unit: Database["public"]["Enums"]["product_unit"];
          category: string | null;
          category_id: string | null;
          stock_qty: number | null;
          position: number;
          image_url: string | null;
          is_available: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          name_fr: string;
          name_ar?: string | null;
          description_fr?: string | null;
          description_ar?: string | null;
          price_da: number;
          unit?: Database["public"]["Enums"]["product_unit"];
          category?: string | null;
          category_id?: string | null;
          stock_qty?: number | null;
          position?: number;
          image_url?: string | null;
          is_available?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          name_fr?: string;
          name_ar?: string | null;
          description_fr?: string | null;
          description_ar?: string | null;
          price_da?: number;
          unit?: Database["public"]["Enums"]["product_unit"];
          category?: string | null;
          category_id?: string | null;
          stock_qty?: number | null;
          position?: number;
          image_url?: string | null;
          is_available?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_merchant_id_fkey";
            columns: ["merchant_id"];
            referencedRelation: "merchants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          id: string;
          merchant_id: string;
          title: string;
          description: string | null;
          image_url: string | null;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          title: string;
          description?: string | null;
          image_url?: string | null;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          title?: string;
          description?: string | null;
          image_url?: string | null;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "categories_merchant_id_fkey";
            columns: ["merchant_id"];
            referencedRelation: "merchants";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          product_name: string;
          unit_price_da: number;
          quantity: number;
          line_total_da: number;
        };
        Insert: {
          id?: string;
          order_id: string;
          product_name: string;
          unit_price_da: number;
          quantity: number;
          line_total_da: number;
        };
        Update: {
          id?: string;
          order_id?: string;
          product_name?: string;
          unit_price_da?: number;
          quantity?: number;
          line_total_da?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: {
      order_status:
        | "pending"
        | "accepted"
        | "preparing"
        | "ready"
        | "completed"
        | "cancelled";
      product_unit: "piece" | "kg" | "l" | "m" | "custom";
    };
    CompositeTypes: Record<never, never>;
  };
};
