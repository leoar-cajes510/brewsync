"""Authorization coverage generated from the live route table (not a hand-picked list):

1. anonymous → every non-public API route answers 401;
2. a cashier with every revocable permission removed → every protected mutation answers 403;
3. object ownership → ids that belong to ANOTHER business answer 404 (never 200/403 leaks).
"""

import re
import unittest
import uuid

from db_support import SCHEMA, DbTestCase

from app.routers.api import PUBLIC_API_PATHS

ZERO = "00000000-0000-0000-0000-000000000000"


def api_routes():
    from app.routers import core, operations
    for route in [*core.router.routes, *operations.router.routes]:
        path = getattr(route, "path", "")
        if not path.startswith("/api/v1/"):
            continue
        for method in sorted(getattr(route, "methods", set()) - {"HEAD", "OPTIONS"}):
            yield method, path


def concrete(path: str, value: str = ZERO) -> str:
    def fill(m: re.Match) -> str:
        name = m.group(1)
        if name == "section":
            return "tax"
        if name == "action":
            return "deactivate" if "/discounts/" in path else "restock"
        if name == "key":
            return "some-key"
        return value
    return re.sub(r"\{(\w+)\}", fill, path)


# Routes any signed-in user may call for their OWN account/session, or that only read POS data the
# cashier role always has (no business mutation behind them).
SELF_SERVICE = {
    ("POST", "/api/v1/auth/logout"), ("POST", "/api/v1/auth/lock"), ("POST", "/api/v1/auth/change-password"),
    ("POST", "/api/v1/auth/change-pin"), ("PATCH", "/api/v1/auth/me"), ("GET", "/api/v1/auth/me"),
    # Read-only interface configuration (features, terminology, branding, tax display…) that every
    # signed-in screen needs; staffing limits are filtered out by the service.
    ("GET", "/api/v1/settings/operational"),
}


# Schema-valid bodies so the request reaches the permission check (FastAPI validates typed bodies first).
SCHEMA_BODIES = [
    ("/settings/{section}", {"version": 1, "data": {}}),
    ("/orders/quote", {"order_type": "takeout", "lines": []}),
    ("/orders", {"order_type": "takeout", "lines": []}),
    ("/status", {"target": "preparing"}),
    ("/cancel", {"reason": "x"}),
    ("/payments", {"method": "cash", "amount": "1.00"}),
    ("/refunds", {"kind": "full", "reason": "x"}),
    ("/archive", {"order_ids": [], "reason": "x"}),
]


class RouteSecurityTests(DbTestCase):
    def execute_many(self, sql: str, **params):  # type: ignore[no-untyped-def]
        for statement in sql.split(";"):
            names = set(re.findall(r":(\w+)", statement))
            self.execute(statement, **{k: v for k, v in params.items() if k in names})

    def test_route_table_is_not_empty(self):
        self.assertGreater(len(list(api_routes())), 60)

    def test_anonymous_requests_are_rejected_before_anything_else(self):
        failures = []
        self.bootstrap()
        for method, path in api_routes():
            if path in PUBLIC_API_PATHS:
                continue
            r = self.client.request(method, concrete(path), json={})
            if r.status_code != 401:
                failures.append((method, path, r.status_code))
        self.assertEqual(failures, [])

    def test_invalid_token_is_rejected(self):
        self.bootstrap()
        r = self.call("GET", "/orders", "bss_not-a-real-token")
        self.assertEqual(r.status_code, 401)

    def test_permissionless_cashier_cannot_mutate_or_read_back_office(self):
        env = self.bootstrap()
        cashier = self.make_cashier(env["admin"], env["device"])
        from app.domain.identity import CASHIER_DEFAULT_GRANTS
        revoke = {p.value: False for p in CASHIER_DEFAULT_GRANTS}
        r = self.call("PUT", "/settings/permissions", env["admin"], {"roles": {"cashier": revoke}})
        self.assertEqual(r.status_code, 200, r.text)
        allowed = []
        for method, path in api_routes():
            if path in PUBLIC_API_PATHS or (method, path) in SELF_SERVICE:
                continue
            body = next((b for suffix, b in SCHEMA_BODIES if path.endswith(suffix)), {})
            r = self.client.request(method, f"{concrete(path)}", json=body,
                                    headers={"Authorization": f"Bearer {cashier}", "Idempotency-Key": str(uuid.uuid4())})
            if r.status_code not in (401, 403):
                allowed.append((method, path, r.status_code, r.text[:120]))
        self.assertEqual(allowed, [], "routes reachable without any granted permission")

    def test_ids_of_another_business_are_not_found(self):
        env = self.bootstrap()
        admin = env["admin"]
        other = uuid.uuid4()
        ids = {k: uuid.uuid4() for k in ("cat", "prod", "ing", "grp", "disc", "exp", "user", "term")}
        role = self.scalar("select id from {s}.roles where key='cashier'")
        self.execute_many(
            "insert into {s}.businesses (id,name,business_type,address,phone,email,currency_code,timezone,created_at) "
            "values (:b,'Other','Cafe','','','','PHP','UTC',now());"
            "insert into {s}.categories (id,business_id,name,code_prefix,sort_order,active) values (:c,:b,'X','XX',0,true);"
            "insert into {s}.products (id,business_id,code,name,description,category_id,price,available,active,track_units,"
            "track_ingredients,tax_class,created_at,updated_at) values (:p,:b,'XX-1','Secret','',:c,10,true,true,false,false,"
            "'taxable',now(),now());"
            "insert into {s}.ingredients (id,business_id,code,name,category,unit,unit_cost,notes,active) "
            "values (:i,:b,'X1','Secret Bean','', 'g',1,'',true);"
            "insert into {s}.stock_levels (id,business_id,subject_type,subject_id,on_hand,reserved,low_stock_threshold,initialized) "
            "values (gen_random_uuid(),:b,'ingredient',:i,100,0,0,true);"
            "insert into {s}.choice_groups (id,business_id,code,name,display_name,description,selection_type,required,"
            "min_select,max_select,active) values (:g,:b,'XG','G','G','','single',false,0,1,true);"
            "insert into {s}.discounts (id,business_id,name,type,value,eligibility,custom_eligibility,active,sort_order,"
            "requires_identification,identification_fields,created_at) values (:d,:b,'D','fixed',5,'all','',true,0,false,'[]',now());"
            "insert into {s}.users (id,business_id,code,username,full_name,role_id,auth_method,status,must_change_credential,"
            "failed_attempts,created_at) values (:u,:b,'U9','spy','Spy',:r,'pin','active',false,0,now());"
            "insert into {s}.terminals (id,business_id,code,name,status,created_at) values (:t,:b,'T9','T','active',now());"
            "insert into {s}.expenses (id,business_id,code,category,description,amount,expense_date,payment_method,notes,"
            "recorded_by,created_at,updated_at) values (:e,:b,'EXP-9','Other','x',5,current_date,'cash','',:u,now(),now())",
            b=other, c=ids["cat"], p=ids["prod"], i=ids["ing"], g=ids["grp"], d=ids["disc"], u=ids["user"], r=role,
            t=ids["term"], e=ids["exp"])
        probes = [
            ("PATCH", f"/categories/{ids['cat']}", {"name": "Hacked"}),
            ("DELETE", f"/categories/{ids['cat']}", None),
            ("PATCH", f"/products/{ids['prod']}", {"price": "1.00"}),
            ("DELETE", f"/products/{ids['prod']}", None),
            ("GET", f"/products/{ids['prod']}/recipe", None),
            ("PUT", f"/products/{ids['prod']}/recipe", {"lines": []}),
            ("PATCH", f"/ingredients/{ids['ing']}", {"name": "Hacked"}),
            ("GET", f"/ingredients/{ids['ing']}/movements", None),
            ("GET", f"/ingredients/{ids['ing']}/dependencies", None),
            ("POST", f"/ingredients/{ids['ing']}/waste", {"quantity": "1", "reason": "spilled"}),
            ("PATCH", f"/ingredients/{ids['ing']}/threshold", {"low_stock_threshold": "1"}),
            ("PATCH", f"/choice-groups/{ids['grp']}", {"name": "Hacked"}),
            ("PATCH", f"/discounts/{ids['disc']}", {"name": "Hacked"}),
            ("POST", f"/discounts/{ids['disc']}/deactivate", None),
            ("PATCH", f"/staff/{ids['user']}", {"full_name": "Hacked"}),
            ("POST", f"/staff/{ids['user']}/deactivate", None),
            ("GET", f"/staff/{ids['user']}/activity", None),
            ("POST", f"/terminals/{ids['term']}/deactivate", None),
            ("POST", f"/terminals/{ids['term']}/revoke", {"reason": "x"}),
            ("PATCH", f"/expenses/{ids['exp']}", {"description": "Hacked"}),
        ]
        leaks = []
        for method, path, body in probes:
            r = self.call(method, path, admin, body, key=str(uuid.uuid4()))
            if r.status_code != 404:
                leaks.append((method, path, r.status_code, r.text[:120]))
        self.assertEqual(leaks, [])
        self.assertEqual(self.scalar("select name from {s}.products where id=:p", p=ids["prod"]), "Secret")
        self.assertEqual(self.scalar("select on_hand from {s}.stock_levels where subject_id=:i", i=ids["ing"]), 100)
        # nothing of the other business appears in lists
        listed = str([self.call("GET", p, admin).json() for p in ("/products", "/ingredients", "/categories",
                                                                  "/choice-groups", "/discounts", "/staff", "/terminals")])
        self.assertNotIn("Secret", listed)
        self.assertNotIn("spy", listed)

    def test_order_cannot_use_another_business_product(self):
        env = self.bootstrap()
        other, cat, prod = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        self.execute_many(
            "insert into {s}.businesses (id,name,business_type,address,phone,email,currency_code,timezone,created_at) "
            "values (:b,'Other','Cafe','','','','PHP','UTC',now());"
            "insert into {s}.categories (id,business_id,name,code_prefix,sort_order,active) values (:c,:b,'X','XX',0,true);"
            "insert into {s}.products (id,business_id,code,name,description,category_id,price,available,active,track_units,"
            "track_ingredients,tax_class,created_at,updated_at) values (:p,:b,'XX-1','Secret','',:c,10,true,true,false,false,"
            "'taxable',now(),now())", b=other, c=cat, p=prod)
        r = self.order(env["admin"], [{"product_id": str(prod), "quantity": 1}], expect=404)
        self.assertEqual(self.scalar("select count(*) from {s}.orders"), 0)
        _ = r, SCHEMA


if __name__ == "__main__":
    unittest.main()
